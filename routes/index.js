import express from "express"
import { handleGetData } from "../controller/index.js"

const router = express.Router();
router.get('/', (req, res) => {
    handleGetData(req, res)
})

export default router;