import mongoose from 'mongoose';
import  env  from './env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);

  const conn = await mongoose.connect(env.MONGODB_URI, {
    autoIndex: true,
  });

  console.log(`MongoDB connected: ${conn.connection.name}`);
  return conn;
}