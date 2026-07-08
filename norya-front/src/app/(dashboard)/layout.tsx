import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
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
        <Topbar />
        <div className="relative z-10 mx-auto grid max-w-[1640px] grid-cols-1 gap-5 px-4 pt-[88px] pb-24 md:grid-cols-[244px_1fr] md:items-start">
          <Sidebar />
          <main className="min-w-0">{children}</main>
        </div>
      </SelectedChannelProvider>
      </OnboardingGuard>
    </AuthGuard>
  );
}
