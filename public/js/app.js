// Ultra Matrix - Frontend JavaScript

// File upload drag & drop
const uploadArea = document.getElementById('uploadArea');
if (uploadArea) {
  ['dragenter', 'dragover'].forEach(event => {
    uploadArea.addEventListener(event, (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    uploadArea.addEventListener(event, (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
    });
  });

  uploadArea.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const input = document.getElementById('csvFile');
      input.files = files;
      handleFileSelect(input);
    }
  });
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;

  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');

  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileInfo.style.display = 'block';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Copy to clipboard helper
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Could show a toast notification here
  });
}

// Auto-refresh for processing jobs
document.addEventListener('DOMContentLoaded', () => {
  const processingBadges = document.querySelectorAll('.badge-processing');
  if (processingBadges.length > 0 && window.location.pathname === '/jobs') {
    setTimeout(() => window.location.reload(), 5000);
  }
});
