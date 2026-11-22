# Farid Ahmad Sadat — frontend

Responsive implementation of the selected Clean Developer design. Built with HTML, CSS, and JavaScript, personalized with Farid's supplied biography and links.

From this folder:

```powershell
npm run dev
```

This starts the backend and serves the complete site at http://127.0.0.1:5173. Node.js 24+, npm dependencies installed from the project root, and a configured MongoDB connection in `backend/.env` are required.

```powershell
npm run build
```

The static production files are generated in `dist/`. A static-only deployment displays the portfolio, but the contact form needs the backend. For the full setup and API details, read `../README.md`.

## Add real projects later

Use `/dashboard` to manage published projects in MongoDB. The following shape is supported by the project API; `assets/profile.json` provides a static fallback:

```json
{
  "title": "Your project name",
  "description": "What you built and the problem it solves.",
  "technologies": ["React.js", "Node.js", "MongoDB"],
  "github": "https://github.com/your-account/your-repository",
  "live": "https://your-project.example"
}
```

The page automatically replaces the coming-soon section with real project cards. Omit `live` when a live deployment is unavailable. The portfolio contains no invented projects or employment history.

## Portfolio dashboard

Open `/dashboard`, enter the key configured as `DASHBOARD_KEY` (use the eye button to show or hide it), and use Projects to add, edit, or remove projects. Skills lets you update the public skills list as you learn. The Profile section lets you upload a public profile photo (PNG, JPEG, or WebP up to 2 MB); it appears in the portfolio header and About section. The theme button switches between light and dark mode and shares the selected theme with the portfolio. Dashboard changes are saved in MongoDB.
