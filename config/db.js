import mongoose from "mongoose";

let cachedConnectionPromise = null;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }
  return uri;
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

const connectDB = async () => {
  if (isDbConnected()) {
    return mongoose.connection;
  }

  if (!cachedConnectionPromise) {
    const mongoUri = getMongoUri();
    cachedConnectionPromise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });
  }

  try {
    const conn = await cachedConnectionPromise;
    console.log(`[db] MongoDB connected: ${conn.connection.host}`);
    return conn.connection;
  } catch (err) {
    cachedConnectionPromise = null;
    console.error("[db] MongoDB connection failed:", err.message);
    throw err;
  }
};

export default connectDB;
