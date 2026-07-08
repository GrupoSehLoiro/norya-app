# Seeds de desenvolvimento — SEHLORO / SLMOD (INFRA-02 / M1)

Scripts Node.js para popular o MongoDB local com dados mínimos de desenvolvimento
(usuários, canais, amostras de chat, configurações de sentimento e de categoria).

> **Aviso importante:** todos os seeds derrubam (`deleteMany({})`) a collection
> correspondente antes de inserir. Não aponte o `MONGODB_URI` para um banco de
> produção. Este diretório é exclusivamente para o ambiente local de dev.

## 1. Instalar

```bash
cd infra/seeds
npm install
```

Dependências: `mongoose`, `dotenv`, `bcrypt`.

## 2. Configurar o `MONGODB_URI`

Você tem duas opções:

### Opção A — reaproveitar o `.env` do `infra/`

Se o `infra/` já tem um `.env` com `MONGODB_URI`, copie para cá:

```bash
cp ../.env .env
```

### Opção B — setar direto

Crie um `.env` em `infra/seeds/` com:

```env
MONGODB_URI=mongodb://dev:devpass@localhost:27017/sehloirostudios_dev?authSource=admin
```

Os credenciais/nome de banco são os padrões usados pelo `infra/docker-compose.yml`
do workspace. Ajuste se seu compose estiver customizado.

Se `MONGODB_URI` não estiver definida, cada seed falha com mensagem clara em pt-BR.

## 3. Rodar

Todos de uma vez:

```bash
npm start
# ou
node seed-all.js
```

Individualmente:

```bash
node seed-users.js
node seed-channels.js
node seed-sentiment.js
node seed-categories.js
node seed-chat-sample.js
```

Saída esperada (ordem do `seed-all.js`):

```
[seed] conectando ao MongoDB...
[seed] conectado.
[seed] users: 3 criados
[seed] channels: 5 criados
[seed] sentimentConfiguration: 15 criados
[seed] categoryConfiguration: 5 criados
[seed] chat-sample (socialListening): 500 criados
[seed] desconectado. Seed concluído com sucesso.
```

## 4. Usar com `docker-compose`

1. Suba o Mongo do workspace:

   ```bash
   cd infra
   docker compose up -d mongo
   ```

2. Garanta que o `MONGODB_URI` dos seeds aponta para `localhost:27017` (ou para
   o host/porta exposto pelo seu compose).

3. Rode o seed:

   ```bash
   cd seeds
   npm start
   ```

## 5. O que é populado

| Collection                 | Qtd.         | Observações                                                                 |
|----------------------------|--------------|-----------------------------------------------------------------------------|
| `users`                    | 3            | 1 `admin` + 2 `user`; senhas com `bcrypt` (salt 10).                        |
| `channels`                 | 5            | `rogerbatt`, `gabsscheidt`, `valorant`, `valorant_br`, `riotgames`.         |
| `sentimentconfigurations`  | 15           | 3 por canal: `positive__<canal>`, `negative__<canal>`, `neutral__<canal>`.  |
| `categoryconfigs`          | 25           | 5 categorias (reclamação, elogio, dúvida, toxicidade, hype) x 5 canais com sufixo `__<canal>`. |
| `sociallistenings`         | 500          | ~40% positive / ~40% negative / ~20% neutral; gírias pt-BR + emotes Twitch. |
| `bans`                     | 60           | Eventos de ban distribuidos nos 5 canais, ultimos 30 dias.                  |
| `timeouts`                 | 200          | Timeouts com duracoes variadas (1min a 1d).                                 |
| `messagedeleteds`          | 350          | Mensagens deletadas com texto plausivel.                                    |
| `predictions`              | 25           | Predictions Twitch com options + winningOutcome + topBetters.               |
| `polls`                    | 30           | Polls com 3-4 choices, votos por bits/channel points.                       |
| `emojis`                   | 400          | Uso de emotes Twitch + unicode em mensagens de chat.                        |
| `logs`                     | 80           | Logs de sistema (info/warning/error/debug) com source variado.              |
| `logplatforms`             | 150          | Eventos de moderacao (LogEventMod): ban, timeout, unban, etc.               |

> Os nomes dos campos seguem **exatamente** os models em
> `SLMOD-api/api/models/` (ex.: `password`, `created_at`, `channelWithPrefix`).
> Os schemas estão redeclarados inline em `_models.js` para evitar acoplamento
> com `SLMOD-api/node_modules`. Qualquer mudança nos models da API precisa ser
> refletida aqui manualmente — o banco é o contrato.

## 6. Usuários criados (credenciais de dev)

| username           | role   | senha      |
|--------------------|--------|------------|
| `admin_sehloiro`   | admin  | `admin123` |
| `moderador_ana`    | user   | `mod123`   |
| `moderador_joao`   | user   | `mod123`   |

Troque estas senhas antes de considerar qualquer ambiente não-local.
