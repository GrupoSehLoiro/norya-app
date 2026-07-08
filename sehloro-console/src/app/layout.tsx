import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Norya',
  description: 'Description -> a fazer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes do paint — evita flash do tema errado.
            Dark é o padrão (sem classe); só adiciona .light se foi escolhido. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('sehloro:theme')==='light'){document.documentElement.classList.add('light');}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
