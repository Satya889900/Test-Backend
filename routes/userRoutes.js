import express from 'express';
import {
    registerUser,
    loginUser,
    getUserProfile,
    updateUserProfile,
    createResume,
    getResume,
    updateResume,
    deleteResume,
    downloadResume,
    getOwnResumeFile,
    getOwnResumes,
    addResume,
    getResumeById,
    updateResumeById,
    deleteResumeById,
    downloadResumeById,
    getOwnResumeFileById
} from '../controllers/userController.js';
import protect from '../middleware/authMiddleware.js';
import uploadResume from '../middleware/uploadMiddleware.js';

const router = express.Router();

const handleResumeUpload = (req, res, next) => {
    uploadResume.single('resume')(req, res, (error) => {
        if (error) {
            return res.status(400).json({ message: error.message });
        }

        next();
    });
};

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);
router.post('/resume', protect, handleResumeUpload, createResume);
router.get('/resume', protect, getResume);
router.get('/resumes', protect, getOwnResumes);
router.post('/resumes', protect, handleResumeUpload, addResume);
router.get('/resumes/:resumeId', protect, getResumeById);
router.put('/resumes/:resumeId', protect, handleResumeUpload, updateResumeById);
router.delete('/resumes/:resumeId', protect, deleteResumeById);
router.get('/resumes/:resumeId/download', protect, downloadResumeById);
router.get('/resumes/:resumeId/file', protect, getOwnResumeFileById);
router.put('/resume', protect, handleResumeUpload, updateResume);
router.delete('/resume', protect, deleteResume);
router.get('/resume/download', protect, downloadResume);
router.get('/resume/file', protect, getOwnResumeFile);

export default router;
