// buySnek.mjs
// npm i lucid-cardano dotenv
import 'dotenv/config';
import { Lucid, Blockfrost, Data, Constr } from 'lucid-cardano';
import {
  NETWORK, ROUTER_ADDR, POOL_ADDR, REF_TXS,
  COST_PER_EX_STEP, EXECUTOR_FEE, PRICE_DENOM, SLIPPAGE_BPS, FEE_BPS_XYK,
  ORDER_TEMPLATE_HEX
} from './snekConfig.mjs';

/* ====== CLI ARGS ======
   Ex.: node buySnek.mjs --policy c2f23c... --ada 1.0
   (asset name é inferido do pool; .env deve ter BLOCKFROST_KEY e MNEMONIC)
*/
const args = Object.fromEntries(process.argv.slice(2).map(s => {
  const m = s.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [s.replace(/^--/,''), true];
}));
const POLICY_ID = (args.policy)
const ADA_FLOAT = args.ada ? Number(args.ada) : null;
if (!/^[0-9a-f]{56}$/.test(POLICY_ID)) throw new Error('Passe --policy <policyId hex 56 chars>');
if (!ADA_FLOAT || !(ADA_FLOAT > 0)) throw new Error('Passe --ada <quantidade>, ex: 1.5');

const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY;
const MNEMONIC       = process.env.MNEMONIC;
if (!BLOCKFROST_KEY || !MNEMONIC) throw new Error('Falta BLOCKFROST_KEY ou MNEMONIC no .env');

const LOVELACE_IN   = BigInt(Math.round(ADA_FLOAT * 1_000_000));
const OVERHEAD_SEND = 2_600_000n; // ~2.6 ₳ p/ min-ADA/fees no router UTXO
const ROUTER_SEND   = LOVELACE_IN + OVERHEAD_SEND;

/* ===== HELPERS ===== */
const api = (p) => fetch(`https://cardano-mainnet.blockfrost.io/api/v0${p}`, {
  headers: { project_id: BLOCKFROST_KEY }
}).then(async r => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${p}: ${await r.text()}`);
  return r.json();
});

const isConstr = (x) => x instanceof Constr ||
  (x && typeof x === 'object' && typeof x.index === 'number' && Array.isArray(x.fields));

function patchLeaves(node, fnLeaf) {
  if (isConstr(node)) return new Constr(node.index, node.fields.map(f => patchLeaves(f, fnLeaf)));
  if (Array.isArray(node)) return node.map(x => patchLeaves(x, fnLeaf));
  if (node instanceof Map) { const m = new Map(); for (const [k,v] of node.entries()) m.set(patchLeaves(k,fnLeaf), patchLeaves(v,fnLeaf)); return m; }
  return fnLeaf(node);
}
const isHex = (s) => typeof s === 'string' && /^[0-9a-f]*$/i.test(s) && s.length % 2 === 0;
function validateHexLeaves(node) {
  if (isConstr(node)) return node.fields.forEach(validateHexLeaves);
  if (Array.isArray(node)) return node.forEach(validateHexLeaves);
  if (node instanceof Map) return [...node.entries()].forEach(([k,v]) => { validateHexLeaves(k); validateHexLeaves(v); });
  if (typeof node === 'string' && !isHex(node)) throw new Error('String não-hex no Plutus Data');
}

/* ===== CORE ===== */
(async () => {
  const lucid = await Lucid.new(new Blockfrost('https://cardano-mainnet.blockfrost.io/api/v0', BLOCKFROST_KEY), NETWORK);
  await lucid.selectWalletFromSeed(MNEMONIC);
  const myAddr = await lucid.wallet.address();
  const { paymentCredential, stakeCredential } = lucid.utils.getAddressDetails(myAddr);
  const myPKH = paymentCredential?.hash?.toLowerCase();
  if (!myPKH || myPKH.length !== 56) throw new Error('Não consegui obter o teu PKH');

  // 1) Encontrar o pool UTXO que tem este policyId
  const poolUtxos = await api(`/addresses/${POOL_ADDR}/utxos?order=desc&count=100`);
  const candidate = poolUtxos.find(u => u.amount.some(a => a.unit !== 'lovelace' && a.unit.startsWith(POLICY_ID)) && (u.inline_datum || u.data_hash));
  if (!candidate) throw new Error('Não encontrei UTXO do pool com esse policyId');

  const unit = candidate.amount.find(a => a.unit.startsWith(POLICY_ID)).unit; // policy+assetNameHex
  const assetNameHex = unit.slice(56); // após policyId
  const rAda = BigInt(candidate.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0');
  const rTok = BigInt(candidate.amount.find(a => a.unit === unit)?.quantity ?? '0');
  if (rAda === 0n || rTok === 0n) throw new Error('Reservas inválidas no pool');

  // 2) Calcular base_price (output/input = tokens/lovelace) e min_marginal_output
  //    base_price = spot * (1 - slippage)
  const BPS = 10_000n;
  const spot_num = rTok * PRICE_DENOM; // (rTok/rAda) com denominador PRICE_DENOM
  const spot_den = rAda;
  const priceNum = (spot_num * (BPS - SLIPPAGE_BPS)) / (spot_den * BPS); // inteiro
  const priceDen = PRICE_DENOM;
  const minMarginalOut = (LOVELACE_IN * priceNum) / priceDen;

  // 3) Patch ao template do datum: troca ADA_in, minOut, outputAsset (policyId/name), address PKH e permitted_executors
  const parsed = Data.from(ORDER_TEMPLATE_HEX);

  // Localizar valores antigos p/ “find&replace controlado”
  // Estes são do template original:
  const OLD_ADA_IN  = 25_000_000n;
  const OLD_MIN_OUT = 11_932_654n;

  const patched = patchLeaves(parsed, (x) => {
    if (typeof x === 'bigint') {
      if (x === OLD_ADA_IN)  return LOVELACE_IN;
      if (x === OLD_MIN_OUT) return minMarginalOut;
      if (x === 100_000_000n || x === 100_000_000_000_000_000n) return x; // mantém denominador
      return x;
    }
    if (typeof x === 'string') {
      // troca outputAsset (policyId/name) do template para o alvo
      if (x.length === 56 && x === 'c2f23c368be003b7bce2edbc962cb2f810b51496a1e01bed23a505e5') return POLICY_ID;
      if (x === '536f6c6469657220776f7274') return assetNameHex || x; // "Soldier wort"
      // troca PKH do receiver e de permitted_executors pela tua
      if (x === 'edbf33f5d6e083970648e39175c49ec1c093df76b6e6a0f1473e4776') return myPKH; // permitted_exec (exemplo)
      if (x === 'cc3231cca2a3b3d1565945b20bc94b08f00db8d4e95d51b15c3ed6c6') return myPKH; // pkh antigo 1
      if (x === 'c97ab83cda371781957cfc890f696fcdbdffc3bf26dde7e83ca57b61') return myPKH; // pkh antigo 2
      return x;
    }
    return x;
  });

  // Valida bytes
  validateHexLeaves(patched);
  const NEW_ORDER_DATUM_HEX = Data.to(patched);

  // 4) Cria a order no router
  const txOrder = await lucid
    .newTx()
    .payToAddressWithData(ROUTER_ADDR, { inline: NEW_ORDER_DATUM_HEX }, { lovelace: ROUTER_SEND })
    .complete();

  const signedOrder = await txOrder.sign().complete();
  const orderHash = await signedOrder.submit();
  console.log(`✅ Order criada: ${orderHash}`);
  console.log(`   token unit   : ${unit}`);
  console.log(`   ADA no UTXO  : ${(Number(ROUTER_SEND)/1e6).toFixed(6)} ₳`);
  console.log(`   minOut (raw) : ${minMarginalOut.toString()}`);

  // 5) Espera confirmar (simples polling)
  const waitTx = async (h) => {
    for (let i=0;i<60;i++) { // ~60 * 3s = ~3min
      try { const j = await api(`/txs/${h}`); if (j && j.block) return true; } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }
    return false;
  };
  const ok = await waitTx(orderHash);
  if (!ok) { console.warn('⚠️ A ordem ainda não confirmou. Podes correr o executor mais tarde com o hash acima.'); return; }

  // 6) Executa a order: consome a tua ordem + o pool
  // 6.1) Descobrir o outref da order no router
  const utxosOrder = await api(`/txs/${orderHash}/utxos`);
  const outIdx = utxosOrder.outputs.findIndex(o => o.address === ROUTER_ADDR && (o.inline_datum || o.data_hash));
  if (outIdx < 0) throw new Error('Não achei o output da ordem no router');
  const ORDER_OUTREF = { txHash: orderHash, outputIndex: outIdx };

  // 6.2) Pool atual (usa o mesmo UTXO encontrado em cima)
  const POOL_OUTREF = { txHash: candidate.tx_hash, outputIndex: candidate.output_index };

  // 6.3) Carregar UTXOs e refs
  const [orderUtxo] = await lucid.utxosByOutRef([ORDER_OUTREF]);
  const [poolUtxo]  = await lucid.utxosByOutRef([POOL_OUTREF]);
  if (!orderUtxo?.datum) orderUtxo.datum = NEW_ORDER_DATUM_HEX; // garantir
  const refUtxos = await (async () => {
    const all = [];
    for (const h of REF_TXS) {
      const j = await api(`/txs/${h}/utxos`);
      j.outputs.forEach((o,i)=>{ if (o.reference_script_hash) all.push({ txHash:h, outputIndex:i }); });
    }
    return await lucid.utxosByOutRef(all);
  })();

  // 6.4) Decode e calcular out com XYK + fee
  const orderDatum = Data.from(orderUtxo.datum);
  const poolDatum  = poolUtxo.datum ? Data.from(poolUtxo.datum) : null; // não precisamos do layout p/ XYK
  const poolAda = BigInt(poolUtxo.assets.lovelace ?? 0n);
  const poolTok = BigInt(poolUtxo.assets[unit] ?? 0n);

  // Min marginal output vem do 3º bigint do datum (layout Snek.fun)
  function pickMinOut(n, acc=[]) {
    if (isConstr(n)) n.fields.forEach(f=>pickMinOut(f,acc));
    else if (Array.isArray(n)) n.forEach(x=>pickMinOut(x,acc));
    else if (typeof n === 'bigint') acc.push(n);
    return acc;
  }
  const bigs = pickMinOut(orderDatum);
  const inputAmount     = bigs.find(x => x === LOVELACE_IN) ?? LOVELACE_IN;
  const minMarginalOut2 = bigs[2] ?? minMarginalOut;

  const xNet   = (inputAmount * (10_000n - FEE_BPS_XYK)) / 10_000n;
  let outTok   = (xNet * poolTok) / (poolAda + xNet);
  if (outTok >= poolTok) outTok = poolTok - 1n;
  if (outTok < minMarginalOut2) {
    throw new Error(`slippage: out=${outTok} < minOut=${minMarginalOut2} (ajusta --ada ou a slippage no snekConfig.mjs)`);
  }

  // 6.5) Montar a tx de execução
  const ROUTER_REDEEMER = Data.to(new Constr(1, []));
  const POOL_REDEEMER   = Data.to(new Constr(0, [2n, 2n, new Constr(0, [])])); // conforme exemplo

  const newPoolAssets = {
    ...poolUtxo.assets,
    lovelace: poolAda + inputAmount,
    [unit]:   poolTok - outTok,
  };
  // Mantemos o mesmo datum do pool (os campos “config” não mudam)
  const newPoolDatumHex = poolUtxo.datum ?? null;

  let txb = lucid
    .newTx()
    .readFrom(refUtxos)
    .collectFrom([orderUtxo], ROUTER_REDEEMER)
    .collectFrom([poolUtxo],  POOL_REDEEMER)
    .payToAddressWithData(POOL_ADDR, newPoolDatumHex ? { inline: newPoolDatumHex } : undefined, newPoolAssets)
    .payToAddress(myAddr, { [unit]: outTok, lovelace: 1_500_000n });

  const tx = await txb.complete();
  const signed = await tx.sign().complete();
  const execHash = await signed.submit();
  console.log(`🎯 Swap executado: ${execHash}`);
  console.log(`   Recebeste     : ${outTok.toString()} (unit ${unit})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
