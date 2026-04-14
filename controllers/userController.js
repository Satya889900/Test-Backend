import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { Readable } from 'stream';
import axios from 'axios';
import cloudinary from '../config/cloudinary.js';

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '7d'
    });
};

export const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email,
            password: hashedPassword
        });

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            token: generateToken(user._id)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getUserProfile = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const latestResume = getLatestResume(req.user);

        res.json({
            _id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            resume: latestResume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { name, email, password } = req.body;

        if (email && email !== user.email) {
            const userExists = await User.findOne({ email });
            if (userExists) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }

        user.name = name || user.name;
        user.email = email || user.email;

        if (password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        const updatedUser = await user.save();

        res.json({
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            token: generateToken(updatedUser._id)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            token: generateToken(user._id)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteResumeFromCloudinary = async (publicId, resourceType = 'raw') => {
    if (!publicId) {
        return;
    }

    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

const buildResumePayload = (file, uploadResult) => ({
    originalName: file.originalname,
    publicId: uploadResult.public_id,
    url: uploadResult.secure_url,
    mimeType: file.mimetype,
    size: file.size,
    extension: path.extname(file.originalname).toLowerCase(),
    resourceType: uploadResult.resource_type
});

const migrateLegacyResumeToArrayIfNeeded = async (user) => {
    if (!user) {
        return;
    }

    if (!user.resume) {
        return;
    }

    const resumes = Array.isArray(user.resumes) ? user.resumes : [];
    const alreadyPresent = resumes.some((resume) => resume?.publicId && resume.publicId === user.resume.publicId);

    if (!alreadyPresent) {
        user.resumes = resumes;
        user.resumes.push(user.resume);
    }

    user.resume = undefined;
    await user.save();
};

const getLatestResume = (user) => {
    const resumes = Array.isArray(user?.resumes) ? user.resumes : [];
    if (resumes.length > 0) {
        return resumes[resumes.length - 1];
    }

    return user?.resume || null;
};

const resolveResumeById = (user, resumeId) => {
    if (!user) {
        return null;
    }

    const resumes = Array.isArray(user.resumes) ? user.resumes : [];
    const match = typeof resumes.id === 'function' ? resumes.id(resumeId) : null;
    return match || null;
};

const uploadFileToCloudinary = (file, folder) => new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        reject(new Error('Cloudinary environment variables are missing'));
        return;
    }

    const publicIdBase = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const uploadStream = cloudinary.uploader.upload_stream(
        {
            folder,
            resource_type: 'auto',
            public_id: `${Date.now()}-${publicIdBase}`,
            overwrite: false
        },
        (error, result) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(result);
        }
    );

    Readable.from(file.buffer).pipe(uploadStream);
});

export const createResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Resume file is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);

        const latestResume = getLatestResume(user);
        const previousPublicId = latestResume?.publicId;
        const previousResourceType = latestResume?.resourceType;
        const uploadResult = await uploadFileToCloudinary(req.file, 'user-resumes');
        const nextResume = buildResumePayload(req.file, uploadResult);

        if (Array.isArray(user.resumes) && user.resumes.length > 0) {
            user.resumes[user.resumes.length - 1] = nextResume;
        } else {
            user.resumes = [nextResume];
        }

        await user.save();
        await deleteResumeFromCloudinary(previousPublicId, previousResourceType);

        res.status(previousPublicId ? 200 : 201).json({
            message: previousPublicId ? 'Resume updated successfully' : 'Resume uploaded successfully',
            resume: nextResume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getResume = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = getLatestResume(user);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        res.json({
            message: 'Resume fetched successfully',
            resume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getOwnResumes = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resumes = Array.isArray(user.resumes) ? user.resumes : [];

        res.json({
            message: 'Resumes fetched successfully',
            resumes
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const addResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Resume file is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);

        const uploadResult = await uploadFileToCloudinary(req.file, 'user-resumes');
        const resume = buildResumePayload(req.file, uploadResult);
        user.resumes = Array.isArray(user.resumes) ? user.resumes : [];
        user.resumes.push(resume);
        await user.save();

        res.status(201).json({
            message: 'Resume added successfully',
            resume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getResumeById = async (req, res) => {
    try {
        const { resumeId } = req.params;
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = resolveResumeById(user, resumeId);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        res.json({
            message: 'Resume fetched successfully',
            resume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateResumeById = async (req, res) => {
    try {
        const { resumeId } = req.params;

        if (!req.file) {
            return res.status(400).json({ message: 'Resume file is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = resolveResumeById(user, resumeId);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const previousPublicId = resume.publicId;
        const previousResourceType = resume.resourceType;
        const uploadResult = await uploadFileToCloudinary(req.file, 'user-resumes');
        const nextResume = buildResumePayload(req.file, uploadResult);

        resume.set(nextResume);
        await user.save();
        await deleteResumeFromCloudinary(previousPublicId, previousResourceType);

        res.json({
            message: 'Resume updated successfully',
            resume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteResumeById = async (req, res) => {
    try {
        const { resumeId } = req.params;
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = resolveResumeById(user, resumeId);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const previousPublicId = resume.publicId;
        const previousResourceType = resume.resourceType;
        resume.deleteOne();
        await user.save();
        await deleteResumeFromCloudinary(previousPublicId, previousResourceType);

        res.json({ message: 'Resume deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Resume file is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);

        const latestResume = getLatestResume(user);
        const previousPublicId = latestResume?.publicId;
        const previousResourceType = latestResume?.resourceType;
        const uploadResult = await uploadFileToCloudinary(req.file, 'user-resumes');

        const nextResume = buildResumePayload(req.file, uploadResult);
        if (Array.isArray(user.resumes) && user.resumes.length > 0) {
            user.resumes[user.resumes.length - 1] = nextResume;
        } else {
            user.resumes = [nextResume];
        }
        await user.save();
        await deleteResumeFromCloudinary(previousPublicId, previousResourceType);

        res.json({
            message: 'Resume updated successfully',
            resume: nextResume
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteResume = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const latestResume = getLatestResume(user);

        if (!latestResume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const resumePublicId = latestResume.publicId;
        const resumeResourceType = latestResume.resourceType;

        if (Array.isArray(user.resumes) && user.resumes.length > 0) {
            user.resumes.pop();
        } else {
            user.resume = undefined;
        }

        await user.save();
        await deleteResumeFromCloudinary(resumePublicId, resumeResourceType);

        res.json({ message: 'Resume deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const downloadResume = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = getLatestResume(user);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const extensionFromResume = resume.extension?.replace('.', '') || '';
        const extensionFromName = path.extname(resume.originalName || '').replace('.', '');
        const format = extensionFromResume || extensionFromName || undefined;

        const downloadUrl = cloudinary.utils.private_download_url(
            resume.publicId,
            format,
            {
                resource_type: resume.resourceType || 'raw',
                type: 'upload',
                attachment: true,
                expires_at: Math.floor(Date.now() / 1000) + 60
            }
        );

        const cloudinaryResponse = await axios.get(downloadUrl, {
            responseType: 'stream'
        });

        res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || resume.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${resume.originalName}"`);

        cloudinaryResponse.data.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getOwnResumeFile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = getLatestResume(user);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const extensionFromResume = resume.extension?.replace('.', '') || '';
        const extensionFromName = path.extname(resume.originalName || '').replace('.', '');
        const format = extensionFromResume || extensionFromName || undefined;

        const resumeUrl = cloudinary.utils.private_download_url(
            resume.publicId,
            format,
            {
                resource_type: resume.resourceType || 'raw',
                type: 'upload',
                expires_at: Math.floor(Date.now() / 1000) + 60
            }
        );

        const cloudinaryResponse = await axios.get(resumeUrl, {
            responseType: 'stream'
        });

        res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || resume.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${resume.originalName}"`);

        cloudinaryResponse.data.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const downloadResumeById = async (req, res) => {
    try {
        const { resumeId } = req.params;
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = resolveResumeById(user, resumeId);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const extensionFromResume = resume.extension?.replace('.', '') || '';
        const extensionFromName = path.extname(resume.originalName || '').replace('.', '');
        const format = extensionFromResume || extensionFromName || undefined;

        const downloadUrl = cloudinary.utils.private_download_url(
            resume.publicId,
            format,
            {
                resource_type: resume.resourceType || 'raw',
                type: 'upload',
                attachment: true,
                expires_at: Math.floor(Date.now() / 1000) + 60
            }
        );

        const cloudinaryResponse = await axios.get(downloadUrl, {
            responseType: 'stream'
        });

        res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || resume.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${resume.originalName}"`);

        cloudinaryResponse.data.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getOwnResumeFileById = async (req, res) => {
    try {
        const { resumeId } = req.params;
        const user = await User.findById(req.user._id).select('resume resumes');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await migrateLegacyResumeToArrayIfNeeded(user);
        const resume = resolveResumeById(user, resumeId);

        if (!resume) {
            return res.status(404).json({ message: 'Resume not found' });
        }

        const extensionFromResume = resume.extension?.replace('.', '') || '';
        const extensionFromName = path.extname(resume.originalName || '').replace('.', '');
        const format = extensionFromResume || extensionFromName || undefined;

        const resumeUrl = cloudinary.utils.private_download_url(
            resume.publicId,
            format,
            {
                resource_type: resume.resourceType || 'raw',
                type: 'upload',
                expires_at: Math.floor(Date.now() / 1000) + 60
            }
        );

        const cloudinaryResponse = await axios.get(resumeUrl, {
            responseType: 'stream'
        });

        res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || resume.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${resume.originalName}"`);

        cloudinaryResponse.data.pipe(res);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
