# Frontend Files Directory

Place your frontend files here:

## File Structure:
```
public/
├── index.html      # Main HTML file (will be served at http://localhost:3000/)
├── style.css       # Your CSS file
├── script.js       # Your JavaScript file
├── images/         # Images folder (optional)
└── assets/         # Other assets (optional)
```

## How to Use:

1. **Put your HTML file here** as `index.html`
2. **Put your CSS file here** (e.g., `style.css` or `styles/main.css`)
3. **Put your JavaScript file here** (e.g., `script.js` or `js/main.js`)

## In your HTML file, reference files like this:

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <h1>Research Assistant</h1>
    <script src="/script.js"></script>
</body>
</html>
```

## API Endpoints:

Your frontend can call these endpoints:

- `POST /api/query` - Submit queries with PDF or DOI
- `POST /api/feedback` - Provide feedback
- `GET /api/health` - Health check

## Example API Call from JavaScript:

```javascript
// Upload PDF and query
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('query', 'What is the main contribution?');

fetch('/api/query', {
    method: 'POST',
    body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

