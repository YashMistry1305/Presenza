// Attendance Report System - Firebase integration (frontend)
// 1) Upload CSV to Firebase Storage
// 2) Call Cloud Function to process CSV and generate PDF

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

const form = document.getElementById("reportForm");
const csvInput = document.getElementById("csvFile");
const emailInput = document.getElementById("email");
const submitBtn = document.getElementById("submitBtn");
const successView = document.getElementById("successView");
const successEmail = document.getElementById("successEmail");
const resetBtn = document.getElementById("resetBtn");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyAn0iNX_qTcvYDuFfox98RLnGfzPWuHBlU",
  authDomain: "presenza-dy.firebaseapp.com",
  projectId: "presenza-dy",
  storageBucket: "presenza-dy.appspot.com",
  messagingSenderId: "1062655496541",
  appId: "1:1062655496541:web:5862a5277d9a920fe0d8b4",
  measurementId: "G-KQCXQNSZG5",
};

// TODO: Replace with your HTTPS Cloud Function URL
// Example: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/generateReport
const FUNCTION_URL = "YOUR_FUNCTION_URL";

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const storage = getStorage(app);

const setButtonState = (label, disabled = true) => {
  submitBtn.textContent = label;
  submitBtn.disabled = disabled;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = csvInput.files[0];
  const email = emailInput.value.trim();

  if (!file) {
    alert("Please select a CSV file.");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    alert("Invalid file type. Please upload a .csv file.");
    return;
  }

  if (!emailPattern.test(email)) {
    alert("Please enter a valid email address.");
    return;
  }

  const filePath = `uploads/${Date.now()}-${file.name}`;
  const fileRef = storageRef(storage, filePath);

  setButtonState("Uploading...", true);

  try {
    // Upload CSV to Firebase Storage (resumable)
    const uploadTask = uploadBytesResumable(fileRef, file, {
      contentType: "text/csv",
    });

    await new Promise((resolve, reject) => {
      uploadTask.on("state_changed", null, reject, resolve);
    });

    const fileUrl = await getDownloadURL(uploadTask.snapshot.ref);

    setButtonState("Processing...", true);

    // Trigger Cloud Function for CSV processing & PDF generation
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        csvPath: filePath,
        csvUrl: fileUrl,
      }),
    });

    if (!response.ok) {
      throw new Error("Report generation failed.");
    }

    successEmail.textContent = email;
    form.hidden = true;
    successView.hidden = false;
  } catch (error) {
    console.error("Upload error:", error);
    alert(
      `${error.code || "error"}: ${
        error.message || "Something went wrong. Please try again."
      }`
    );
  } finally {
    setButtonState("Submit & Generate Report", false);
  }
});

resetBtn.addEventListener("click", () => {
  form.reset();
  form.hidden = false;
  successView.hidden = true;
});
