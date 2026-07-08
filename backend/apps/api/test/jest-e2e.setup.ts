process.env.NODE_ENV = 'test';
// Permite override externo (E2E rodando contra container Mongo do compose).
// Default = localhost: usado por specs com mongodb-memory-server (Node host com glibc).
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
}
process.env.JWT_SECRET = 'a'.repeat(40);
process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.LOG_LEVEL = 'fatal';
