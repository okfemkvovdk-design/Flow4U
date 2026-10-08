# Flow4U

A simple staff, project and task management site. It is plain HTML, CSS and JavaScript with no build step, so it runs as-is on GitHub Pages or any static web host.

## What it does

- **Staff, projects and tasks**: add, edit, delete, search, filter and sort. Tasks can be linked to a project and assigned to a staff member.
- **Overview**: open and overdue work, project progress and team workload, all calculated from your own records.
- **File attachments**: attach files to a task (drag and drop works too). Images, PDFs and text files open in a new tab; other files download.
- **Excel import**: import `.xlsx`, `.xls`, `.ods` or `.csv` files. Download the blank template from *Import & export* to see the expected columns. Every import shows a preview before anything changes.
- **Export**: Excel workbook, CSV per list (UTF-8, so Arabic text displays correctly in Excel), and a Word report (`.doc`).
- **Print**: every page has a print layout, which can also be saved as PDF.
- **Backup and restore**: one `.json` file holding every record and attached file.
- **Quick tour**: an optional five-step walkthrough, offered on first visit and available from the sidebar.

The site starts empty. There is no built-in sample data.

## Where data is stored

Everything is stored in the visitor's own browser: records in `localStorage`, attached files in `IndexedDB`. Nothing is sent to a server.

This means:

- Each browser and device has its own separate data. People visiting your GitHub Pages link will not see your records.
- Clearing the browser's site data deletes the records. Use **Download backup** regularly.
- To move data to another computer, download a backup and restore it there.

## Running locally

Double-click `index.html` to open it in a browser. Note that data saved while opening the file directly is kept separately from data saved on your GitHub Pages site, because browsers store data per address. Use **Download backup** and **Restore** to move it between them.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, dialogs and icons |
| `style.css` | Styles, including dark mode and print layout |
| `script.js` | All application logic |
| `favicon.svg` | Browser tab icon |
| `vendor/xlsx.full.min.js` | [SheetJS Community Edition](https://sheetjs.com) 0.20.3, used for Excel files |
| `vendor/xlsx-LICENSE.txt` | SheetJS licence (Apache 2.0) |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

Icons are based on [Lucide](https://lucide.dev) (ISC licence).
