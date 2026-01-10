export type Nut19Policy = {
	ttl: number; // milliseconds
	cached_endpoints: Array<{ method: 'GET' | 'POST'; path: string }>;
} | null;
