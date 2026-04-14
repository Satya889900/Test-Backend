import path from 'path';
import multer from 'multer';

const allowedMimeTypes = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx']);

const fileFilter = (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const isAllowedMimeType = allowedMimeTypes.has(file.mimetype);
    const isAllowedExtension = allowedExtensions.has(extension);

    if (isAllowedMimeType && isAllowedExtension) {
        return cb(null, true);
    }

    cb(new Error('Only PDF, Word, and Excel files are allowed'));
};

const uploadResume = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

export default uploadResume;
