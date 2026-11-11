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

/**
 * Recherche un joueur par pseudo.
 *
 * L ERREUR EST PROPAGEE (et non absorbee en liste vide) : une panne reseau
 * ou un serveur injoignable se lisait comme « ce joueur n existe pas »,
 * et le joueur en concluait que son pseudo etait faux.
 */
export const searchUsers = async (query: string): Promise<SearchUser[]> => {
  const res = await authorizedGet<SearchResponse>(`/api/users/search?q=${encodeURIComponent(query)}`);
  return res.users || [];
};
