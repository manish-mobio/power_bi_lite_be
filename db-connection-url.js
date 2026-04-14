const { DB_NAME, DATABASE_URL } = process.env;

const url = DATABASE_URL || `mongodb://127.0.0.1:27017/${DB_NAME}`;

export default url;
