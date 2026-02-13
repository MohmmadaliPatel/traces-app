import multer from "multer"
import path from "path"
import fs from "fs"

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = req.query?.path

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    cb(null, dir)
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now()
    const ext = path.extname(file.originalname)
    const name = path.basename(file.originalname, ext)
    cb(null, `${name}-${timestamp}${ext}`)
  },
})

// Configure multer
const upload = multer({ storage: storage })

export const config = {
  api: {
    bodyParser: false, // Disable body parsing, multer will handle it
  },
}

export default async function handler(req, res) {
  if (req.method === "POST") {

    // Use multer middleware to handle file uploads
    upload.array("file")(req, res, async (err) => {
      if (err) {
        // Handle upload error
        return res.status(500).json({ error: "Upload failed" })
      }

      // File uploaded successfully
      const files = req.files
      // If multiple files, map through the array and create file paths
      const filePaths = files.map((file) => {
        return {
          originalName: file.originalname,
          uploadedName: file.filename,
          path: `${req.query?.path}/${file.filename}`, // Construct file path
        }
      })

      // Respond with the file paths
      res.status(200).json({
        success: true,
        files: filePaths,
      })
    })
  } else {
    res.status(405).json({ message: "Method Not Allowed" })
  }
}
