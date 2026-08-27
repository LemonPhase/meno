import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// On Cloud Run credentials come from the attached service account; locally
// from GOOGLE_APPLICATION_CREDENTIALS or ADC. Against the Firestore emulator
// (FIRESTORE_EMULATOR_HOST set) only a project id is needed.
const app =
  getApps()[0] ??
  initializeApp({ projectId: process.env.GCP_PROJECT_ID });

export const db = getFirestore(app);
