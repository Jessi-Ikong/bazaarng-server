const mongoose = require('mongoose');

// Transient connection issues (e.g. Atlas briefly losing its primary during
// an election) are normal and recoverable — mongoose's default driver
// already retries automatically. Without a listener here, an 'error' event
// on the connection has no handler and Node throws it as an uncaught
// exception, killing the whole process over what should have been a
// survivable blip. These listeners exist purely to log it and let mongoose
// carry on reconnecting.
mongoose.connection.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] MongoDB connection error: ${err.message}`, err);
});

mongoose.connection.on('disconnected', () => {
  console.error(`[${new Date().toISOString()}] MongoDB disconnected — mongoose will attempt to reconnect automatically.`);
});

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
