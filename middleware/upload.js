import multer from "multer";

const storage = multer.memoryStorage();

// File size limit: 10MB (adjust as needed)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5, // max 5 files per upload
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types but log them
    console.log(`[Upload] Receiving file: ${file.originalname}, type: ${file.mimetype}, size: ${file.size || 'unknown'}`);
    cb(null, true);
  },
});

// Middleware to handle multer errors gracefully
export function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Too many files uploaded at once." });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ message: `Unexpected field name: ${err.field}. Expected 'file' or 'files'.` });
    }
    return res.status(400).json({ message: `Upload error: ${err.message}` });
  }
  // Pass through non-multer errors
  next(err);
}
