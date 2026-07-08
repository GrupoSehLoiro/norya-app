/** @type {import('next').NextConfig} */
const apiTarget = process.env.SEHLORO_API_URL || 'http://localhost:8080';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Proxy de TODAS as chamadas /api/* para o backend SEHLORO (nginx :8080).
  // Decisão de arquitetura: mantemos a base URL fora do bundle do client
  // — o navegador só vê requests relativas; o servidor Next reescreve.
  // Bom para (1) sem CORS, (2) troca de host sem rebuild do frontend.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
