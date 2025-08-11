// snekConfig.mjs
export const NETWORK = 'Mainnet';

// ENDEREÇOS FIXOS (os que temos usado nas tuas txs)
export const ROUTER_ADDR =
  'addr1zx0ff6zgfqhlk2l0ullxct63w8yepp448vlh8af4lasu5z0898g829xezutpzpm8qsguauawdw2jrrp3rqxxz85q4d9qylkkef';

export const POOL_ADDR =
  'addr1xxg94wrfjcdsjncmsxtj0r87zk69e0jfl28n934sznu95tdj764lvrxdayh2ux30fl0ktuh27csgmpevdu89jlxppvrs2993lw';

// Reference scripts (CIP-33) que já confirmámos
export const REF_TXS = [
  '75f04884fd3fe7780f9e0cbde69bf59e6ae0dd7927263b2db72303fb68c7352d',
  '768e326756cec09641fc8b0b6c3bdcb92e5aa45636304ea30794c889bf68f481',
  'c4a540ac2e06c217dd4fb3f39ca3863da394ba134677dafa9b98830ca71d584d',
];

// Constantes do order-datum (observadas em exemplos Snek.fun)
export const COST_PER_EX_STEP = 600_000n;    // 0.6 ₳
export const EXECUTOR_FEE     = 500_000n;    // 0.5 ₳ fixo ao executor
export const PRICE_DENOM      = 100_000_000n; // 1e8 (o que vimos nas tuas orders)
export const SLIPPAGE_BPS     = 2000n;         // 1% pior que spot
export const FEE_BPS_XYK      = 30n;          // 0.30% — usar no cálculo offchain do swap

// “Template” de datum de ordem (o mesmo formato que já usámos antes).
// Vamos patchar: ADA_in, minOut, outputAsset (policy+name) e o teu PKH na morada e permitted_executors.
export const ORDER_TEMPLATE_HEX =
  'd8799f4101d8799fd8799f581ccc3231cca2a3b3d1565945b20bc94b08f00db8d4e95d51b15c3ed6c6ffd8799fd8799fd8799f581ce729d07514d917161107670411cef3ae6b95218c31180c611e80ab4affffffffd8799f4040ff1a017d78401a000927c0d8799f581cc2f23c368be003b7bce2edbc962cb2f810b51496a1e01bed23a505e54c536f6c6469657220776f7274ffd8799f1a00b613ee1a0dac49e4ff1a0007a120581cedbf33f5d6e083970648e39175c49ec1c093df76b6e6a0f1473e47761a000f4240581ccc3231cca2a3b3d1565945b20bc94b08f00db8d4e95d51b15c3ed6c6581cd9d5a815413d5e4cb27b8a0ebd2d519985750e9c4211f60258ac4df6ff';
