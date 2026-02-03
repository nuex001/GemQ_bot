import mongoose from "mongoose";
const { Schema } = mongoose;

const projectSchema = new Schema(
  {
    userId: {
      type: Number,
      unique: true,
      required: true,
    },
    username: {
      type: String,
    },
    file_id: {
      type: String,
    },
    code: {
      unique: true,
      type: String,
      required: true,
    },
    chatId: {
      unique: true,
      type: String,
    },
    tokens: {
      type: Number,
      default: 500,
    },
    role: { type: String, default: "user" },
  },
  { timestamps: true },
);

//model
const ProjectModel = mongoose.model("project", projectSchema);

export { ProjectModel };
