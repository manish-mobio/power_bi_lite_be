import userTbl from "../models/index.js"

async function handleGetData(req, res, next) {
    try {
        const data = await userTbl.find({});
        console.log('get all data::', data);
        return res.status(200).json(data)
    } catch (error) {
        next(error)
    }
}
export { handleGetData }