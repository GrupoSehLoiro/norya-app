import { redirect } from 'next/navigation';

/**
 * Página /integrations/kick DESATIVADA.
 *
 * A conexão de canal agora acontece pela página Canais (modal "Conectar"), e o
 * OAuth volta pra lá ao concluir. Mantida apenas como redirect para não quebrar
 * links/bookmarks antigos.
 */
export default function IntegrationsKickDisabled() {
  redirect('/channels');
}
