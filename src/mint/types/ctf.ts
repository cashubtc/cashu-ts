import type {
  Proof,
  SerializedBlindedMessage,
  SerializedBlindedSignature,
} from '../../model/types';

export interface CtfConditionPartition {
  partition?: string[];
  collateral: string;
  parent_collection_id: string;
  keysets: Record<string, string>;
  registered_at?: number;
}

export interface CtfConditionInfo {
  condition_id: string;
  threshold?: number;
  tags?: string[][];
  announcements?: string[];
  partitions: CtfConditionPartition[];
  registered_at?: number;
  condition_type?: string;
  lo_bound?: number;
  hi_bound?: number;
  precision?: number;
  attestation?: {
    status: string;
    winning_outcome?: string | null;
    attested_at?: number | null;
  };
}

export interface ConditionalKeysetInfo {
  id: string;
  unit: string;
  active: boolean;
  input_fee_ppk?: number;
  final_expiry?: number;
  condition_id: string;
  outcome_collection: string;
  outcome_collection_id: string;
  registered_at?: number;
}

export interface GetConditionalKeysetsQuery {
  since?: number;
  limit?: number;
  active?: boolean;
}

export interface ConditionalKeysetsResponse {
  keysets: ConditionalKeysetInfo[];
}

export interface GetConditionsQuery {
  since?: number;
  limit?: number;
  status?: string[];
}

export interface GetConditionsResponse {
  conditions: CtfConditionInfo[];
}

export interface RegisterConditionRequest {
  threshold?: number;
  tags?: string[][];
  announcements: string[];
  condition_type?: string;
  lo_bound?: number;
  hi_bound?: number;
  precision?: number;
}

export interface RegisterConditionResponse {
  condition_id: string;
}

export interface RegisterPartitionRequest {
  collateral: string;
  partition?: string[];
  parent_collection_id?: string;
}

export interface RegisterPartitionResponse {
  keysets: Record<string, string>;
}

export interface CtfSplitRequest {
  condition_id: string;
  inputs: Proof[];
  outputs: Record<string, SerializedBlindedMessage[]>;
}

export interface CtfSplitResponse {
  signatures: Record<string, SerializedBlindedSignature[]>;
}

export interface CtfMergeRequest {
  condition_id: string;
  inputs: Record<string, Proof[]>;
  outputs: SerializedBlindedMessage[];
}

export interface CtfMergeResponse {
  signatures: SerializedBlindedSignature[];
}

export interface RedeemOutcomeRequest {
  inputs: Proof[];
  outputs: SerializedBlindedMessage[];
}

export interface RedeemOutcomeResponse {
  signatures: SerializedBlindedSignature[];
}
