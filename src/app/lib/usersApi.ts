import { authorizedGet } from './apiClient';

export interface SearchUser {
  id: string;
  pseudo: string;
  avatar?: string;
  country: string;
  trustScore: number;
  controllerType: string;
  isOnline: boolean;
}

interface SearchResponse {
  ok: boolean;
  users: SearchUser[];
}

export const searchUsers = async (query: string): Promise<SearchUser[]> => {
  try {
    const res = await authorizedGet<SearchResponse>(`/api/users/search?q=${encodeURIComponent(query)}`);
    return res.users || [];
  } catch (error) {
    return [];
  }
};
