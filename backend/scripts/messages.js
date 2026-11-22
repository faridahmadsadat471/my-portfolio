import { MongoClient } from 'mongodb';

const mongoClient = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
try {
  await mongoClient.connect();
  const database = mongoClient.db(process.env.MONGODB_DB || 'portfolio');
  const messages = database.collection(process.env.MONGODB_MESSAGES_COLLECTION || 'messages');
  const rows = await messages.find({}, { projection: { _id: 1, name: 1, email: 1, subject: 1, message: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray();
  if (!rows.length) console.log('No messages yet.');
  else console.log(JSON.stringify(rows.map(row => ({ id: row._id, name: row.name, email: row.email, subject: row.subject, message: row.message, createdAt: row.createdAt })), null, 2));
} finally {
  await mongoClient.close();
}
