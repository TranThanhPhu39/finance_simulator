import type { Abi } from 'viem';
import artifact from './abi/PolicyModule.json';

// Full compiler ABI, including nested custom error decoding. Avoid maintaining a second ABI by hand.
export const POLICY_ABI = artifact as Abi;
