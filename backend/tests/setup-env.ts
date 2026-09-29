import dotenv from 'dotenv';

dotenv.config();
process.env.NODE_ENV = 'test';
// Isolated Redis logical DB so tests never touch the dev server's keys
process.env.REDIS_URL = `${(process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '')}/15`;
