import mongoose from "mongoose"

export async function connectToMongodb(url) {
    try {
        const connectionString = await mongoose.connect(url)
        return connectionString
    } catch (error) {
        console.log('Error in connection with mongoDB');

    }
}

