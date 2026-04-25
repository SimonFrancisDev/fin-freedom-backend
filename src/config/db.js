import mongoose from 'mongoose';
import env from './env.js';

let connectionPromise = null;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  mongoose.set('strictQuery', true);

  connectionPromise = mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.DB_AUTO_INDEX,
    maxPoolSize: env.DB_MAX_POOL_SIZE,
    serverSelectionTimeoutMS: env.DB_SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: env.DB_SOCKET_TIMEOUT_MS,
  });

  try {
    const conn = await connectionPromise;
    console.log(`MongoDB connected: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}










// import mongoose from 'mongoose';
// import  env  from './env.js';

// export async function connectDB() {
//   mongoose.set('strictQuery', true);

//   const conn = await mongoose.connect(env.MONGODB_URI, {
//     autoIndex: true,
//   });

//   console.log(`MongoDB connected: ${conn.connection.name}`);
//   return conn;
// }