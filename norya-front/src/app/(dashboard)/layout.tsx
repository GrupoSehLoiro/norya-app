import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { ProfileMenu } from '@/components/layout/profile-menu';
import { Ambient } from '@/components/layout/ambient';
import { AuthGuard } from '@/components/auth/auth-guard';
import { OnboardingGuard } from '@/components/auth/onboarding-guard';
import { SelectedChannelProvider } from '@/hooks/use-selected-channel';
import { MonitoringRealtime } from '@/components/monitoring/monitoring-realtime';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <OnboardingGuard>
      <SelectedChannelProvider>
        <MonitoringRealtime />
        <Ambient />
        {/* Flex (não grid fixo) — a sidebar pode recolher para 64px. O menu
            do perfil ancora no canto superior direito do CONTEÚDO (posição
            absoluta no container), não da viewport. */}
        <div className="relative z-10 mx-auto flex max-w-[1640px] items-start gap-5 px-4 pt-6 pb-24">
          <ProfileMenu />
          <Sidebar />
          <main className="min-w-0 flex-1 pt-8">{children}</main>
        </div>
      </SelectedChannelProvider>
      </OnboardingGuard>
    </AuthGuard>
  );
}
