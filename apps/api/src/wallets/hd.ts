import { createHash, createHmac, randomBytes } from 'crypto';
import { keyPairFromSeed } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { Address } from '@ton/core';
import { TronWeb } from 'tronweb';
import { encryptSecret, decryptSecret } from '../common/crypto.util';

/**
 * Real HD deposit wallets from master mnemonics in env.
 * TON: Wallet V4R2 non-bounceable (UQ…)
 * TRC20: secp256k1 → Tron address (T…)
 */

function normalizeMnemonic(raw: string | undefined | null): string {
  return (raw || '').trim().replace(/\s+/g, ' ');
}

/** BIP39 demo phrase — treat as unset so UI never shows it. */
function isPlaceholderMnemonic(mnemonic: string): boolean {
  const words = mnemonic.toLowerCase().split(' ').filter(Boolean);
  if (!words.length) return true;
  return words.every((w) => w === 'abandon' || w === 'about');
}

export function readMasterMnemonic(network: 'TON' | 'TRC20'): string | null {
  const raw = normalizeMnemonic(
    network === 'TON' ? process.env.TON_HD_MNEMONIC : process.env.TRON_HD_MNEMONIC,
  );
  if (!raw || isPlaceholderMnemonic(raw)) return null;
  return raw;
}

function masterSeed(network: 'TON' | 'TRC20'): Buffer {
  const mnemonic = readMasterMnemonic(network) || '';
  const material = mnemonic || `dev-insecure-${network}-seed`;
  return createHash('sha256').update(`${network}:v2:${material}`).digest();
}

function childSeed(network: 'TON' | 'TRC20', index: number): Buffer {
  return createHmac('sha256', masterSeed(network))
    .update(`deposit/${index}`)
    .digest();
}

function deriveTon(index: number) {
  const seed = childSeed('TON', index);
  const keyPair = keyPairFromSeed(seed);
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const address = wallet.address.toString({
    urlSafe: true,
    bounceable: false,
    testOnly: false,
  });
  return {
    address,
    privateKeyHex: Buffer.from(keyPair.secretKey).toString('hex'),
    publicKeyHex: Buffer.from(keyPair.publicKey).toString('hex'),
  };
}

function deriveTron(index: number) {
  const seed = childSeed('TRC20', index);
  const privateKeyHex = seed.toString('hex');
  const address = TronWeb.address.fromPrivateKey(privateKeyHex);
  if (!address) throw new Error('Не удалось вывести TRON-адрес');
  return {
    address: String(address),
    privateKeyHex,
    publicKeyHex: '',
  };
}

export function deriveDepositWallet(network: 'TON' | 'TRC20', index: number) {
  const derived = network === 'TON' ? deriveTon(index) : deriveTron(index);
  return {
    address: derived.address,
    privateKeyEnc: encryptSecret(derived.privateKeyHex),
    derivationIdx: index,
    publicKeyHex: derived.publicKeyHex,
  };
}

export function revealWalletKey(privateKeyEnc: string) {
  return decryptSecret(privateKeyEnc);
}

export function isValidOnchainAddress(network: 'TON' | 'TRC20', address: string): boolean {
  try {
    if (network === 'TRC20') {
      return Boolean(TronWeb.isAddress(address));
    }
    Address.parse(address);
    return true;
  } catch {
    return false;
  }
}

export function masterMnemonicHint(network: 'TON' | 'TRC20') {
  const raw = readMasterMnemonic(network);
  if (!raw) {
    return {
      configured: false,
      preview: '',
    };
  }
  const words = raw.split(/\s+/);
  return {
    configured: true,
    wordCount: words.length,
    preview: `${words.slice(0, 2).join(' ')} … ${words[words.length - 1]} (${words.length} слов)`,
  };
}

export function nextRandomSalt(): string {
  return randomBytes(8).toString('hex');
}
