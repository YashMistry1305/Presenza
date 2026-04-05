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
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const form = document.getElementById("reportForm");
const practicalInput = document.getElementById("practicalCsv");
const theoryInput = document.getElementById("theoryCsv");
const emailInput = document.getElementById("email");
const submitBtn = document.getElementById("submitBtn");
const successView = document.getElementById("successView");
const successEmail = document.getElementById("successEmail");
const resetBtn = document.getElementById("resetBtn");
const reportView = document.getElementById("reportView");
const overallTable = document.getElementById("overallTable");
const practicalTable = document.getElementById("practicalTable");
const theoryTable = document.getElementById("theoryTable");
const downloadReport = document.getElementById("downloadReport");
const downloadHint = document.getElementById("downloadHint");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyAn0iNX_qTcvYDuFfox98RLnGfzPWuHBlU",
  authDomain: "presenza-dy.firebaseapp.com",
  projectId: "presenza-dy",
  storageBucket: "presenza-dy.firebasestorage.app",
  messagingSenderId: "1062655496541",
  appId: "1:1062655496541:web:5862a5277d9a920fe0d8b4",
  measurementId: "G-KQCXQNSZG5",
};

// TODO: Replace with your HTTPS Cloud Function URL
// Example: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/generateReport
const FUNCTION_URL = "https://us-central1-presenza-dy.cloudfunctions.net/generateReport";

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const storage = getStorage(app);

const setButtonState = (label, disabled = true) => {
  submitBtn.textContent = label;
  submitBtn.disabled = disabled;
};

const formatPercent = (value) => `${Number(value).toFixed(1)}%`;
const generatePdfReport = (email, report) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), "F");
  doc.setFillColor(204, 0, 0);
  doc.rect(0, 0, pageWidth, 18, "F");
  doc.setFillColor(248, 187, 0);
  doc.rect(0, 18, pageWidth, 10, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 24, 28);
  doc.text("Attendance Defaulter Report", margin, 64);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80, 88, 96);
  doc.text(`Generated for: ${email}`, margin, 82);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, 98);

  const buildRows = (rows, key) =>
    (rows || []).map((row) => [
      row.rollNo || "-",
      row.name || "-",
      row.class || "-",
      formatPercent(key === "overallPercent" ? row.overallPercent : row[key]),
    ]);

  const sections = [
    {
      title: "Overall Defaulters (Overall < 75%)",
      rows: buildRows(report.overallDefaulters, "overallPercent"),
      columnLabel: "Overall %",
    },
    {
      title: "Practical Defaulters (Practical < 75%)",
      rows: buildRows(report.practicalDefaulters, "practicalPercent"),
      columnLabel: "Practical %",
    },
    {
      title: "Theory Defaulters (Theory < 75%)",
      rows: buildRows(report.theoryDefaulters, "theoryPercent"),
      columnLabel: "Theory %",
    },
  ];

  let currentY = 120;
  sections.forEach((section) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 36, 42);
    doc.text(section.title, margin, currentY);

    autoTable(doc, {
      startY: currentY + 10,
      head: [["Roll No", "Name", "Class", section.columnLabel]],
      body: section.rows.length ? section.rows : [["-", "-", "-", "-"]],
      styles: {
        font: "helvetica",
        fontSize: 10,
        textColor: [30, 36, 42],
        cellPadding: 6,
      },
      headStyles: {
        fillColor: [244, 244, 244],
        textColor: [30, 36, 42],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      margin: { left: margin, right: margin },
    });

    currentY = doc.lastAutoTable.finalY + 20;
  });

  return doc.output("blob");
};

const renderTable = (rows, averageKey, averageLabel) => {
  if (!rows || rows.length === 0) {
    return '<div class="report__empty">No students found.</div>';
  }

  const header = `
    <div class="report__row report__row--header">
      <span>Roll No</span>
      <span>Name</span>
      <span>Class</span>
      <span>${averageLabel}</span>
    </div>
  `;

  const body = rows
    .map((row) => {
      const fallbackOverall = (row.practicalPercent + row.theoryPercent) / 2;
      const averageValue =
        averageKey === "overallPercent"
          ? row.overallPercent ?? fallbackOverall
          : row[averageKey];

      return `
        <div class="report__row">
          <span>${row.rollNo || "-"}</span>
          <span>${row.name || "-"}</span>
          <span>${row.class || "-"}</span>
          <span>${formatPercent(averageValue)}</span>
        </div>
      `;
    })
    .join("");

  return `${header}${body}`;
};


form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const practicalFile = practicalInput.files[0];
  const theoryFile = theoryInput.files[0];
  const email = emailInput.value.trim();

  if (!practicalFile || !theoryFile) {
    alert("Please select both Practical and Theory CSV files.");
    return;
  }

  if (
    !practicalFile.name.toLowerCase().endsWith(".csv") ||
    !theoryFile.name.toLowerCase().endsWith(".csv")
  ) {
    alert("Invalid file type. Please upload .csv files only.");
    return;
  }

  if (!emailPattern.test(email)) {
    alert("Please enter a valid email address.");
    return;
  }

  const practicalPath = `uploads/practical/${Date.now()}-${practicalFile.name}`;
  const theoryPath = `uploads/theory/${Date.now()}-${theoryFile.name}`;
  const practicalRef = storageRef(storage, practicalPath);
  const theoryRef = storageRef(storage, theoryPath);

  setButtonState("Uploading...", true);

  try {
    // Upload CSV to Firebase Storage (resumable)
    const practicalTask = uploadBytesResumable(practicalRef, practicalFile, {
      contentType: "text/csv",
    });

    const theoryTask = uploadBytesResumable(theoryRef, theoryFile, {
      contentType: "text/csv",
    });

    await Promise.all([
      new Promise((resolve, reject) => {
        practicalTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            );
            setButtonState(`Uploading practical... ${progress}%`, true);
          },
          reject,
          resolve
        );
      }),
      new Promise((resolve, reject) => {
        theoryTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            );
            setButtonState(`Uploading theory... ${progress}%`, true);
          },
          reject,
          resolve
        );
      }),
    ]);

    const practicalUrl = await getDownloadURL(practicalTask.snapshot.ref);
    const theoryUrl = await getDownloadURL(theoryTask.snapshot.ref);
    console.log("Uploads complete:", {
      practicalPath,
      practicalUrl,
      theoryPath,
      theoryUrl,
    });

    setButtonState("Processing...", true);

    if (FUNCTION_URL.includes("YOUR_FUNCTION_URL")) {
      throw new Error(
        "Cloud Function URL is not configured. Set FUNCTION_URL to your deployed function."
      );
    }

    // Trigger Cloud Function for CSV processing & PDF generation
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        practicalPath,
        practicalUrl,
        theoryPath,
        theoryUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Report generation failed.");
    }

    const report = await response.json();

    overallTable.innerHTML = renderTable(
      report.overallDefaulters,
      "overallPercent",
      "Overall %"
    );
    practicalTable.innerHTML = renderTable(
      report.practicalDefaulters,
      "practicalPercent",
      "Practical %"
    );
    theoryTable.innerHTML = renderTable(
      report.theoryDefaulters,
      "theoryPercent",
      "Theory %"
    );

    const pdfBlob = generatePdfReport(email, report);
    const pdfUrl = URL.createObjectURL(pdfBlob);
    downloadReport.href = pdfUrl;
    downloadReport.hidden = false;
    downloadHint.hidden = false;
    reportView.hidden = false;

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
  reportView.hidden = true;
  downloadReport.hidden = true;
  downloadHint.hidden = true;
  downloadReport.removeAttribute("href");
});
