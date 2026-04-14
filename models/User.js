import mongoose from 'mongoose';

const resumeFields = {
    originalName: {
        type: String,
        required: true
    },
    publicId: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    },
    mimeType: {
        type: String,
        required: true
    },
    size: {
        type: Number,
        required: true
    },
    extension: {
        type: String,
        required: true
    },
    resourceType: {
        type: String,
        required: true
    }
};

// Legacy single-resume (kept for backward compatibility).
const resumeSchema = new mongoose.Schema(resumeFields, { _id: false });

// New multi-resume array items (needs _id for targeting a specific resume).
const resumeItemSchema = new mongoose.Schema(resumeFields);

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {      
        type: String,
        required: true,
        unique: true
    },
    password: {       
        type: String,
        required: true
    },
    resume: resumeSchema,
    resumes: {
        type: [resumeItemSchema],
        default: []
    }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
