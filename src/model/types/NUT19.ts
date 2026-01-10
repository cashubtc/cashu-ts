export type Nut19Policy = {
	ttl: number;
	cached_endpoints: Array<{ method: 'GET' | 'POST'; path: string }>;
} | null;
