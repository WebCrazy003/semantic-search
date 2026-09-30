# DocSage: User Specification

**Version:** MVP 1.0
**Date:** 2026-09-20
**Companion document:** the developer plan in `docs/superpowers/plans/`

---

## 1. What this is

A search tool for your own PDF and Word documents that understands **meaning**, not just matching words.

Ask "how often should the seals be replaced" and it finds the passage about maintenance intervals, even when that passage never uses the word "often". Ask in Korean and it can find the answer inside a Chinese document.

Everything runs on your own machine. No document, no search, and no part of your data ever leaves it.

## 2. Who it is for

Someone with a folder of technical manuals, contracts, or reports in Chinese, Korean, or English, who needs to find the right paragraph quickly and cannot send those documents to a cloud service.

## 3. What you can do

| You want to | You do this |
|---|---|
| Make documents searchable | On the **Documents** tab, press **Add documents** and import PDF or Word (.docx) files |
| Find a passage | Type a question or phrase, press **Search** |
| See what is searchable | Open the **Documents** tab |
| Search across languages | Just search. Chinese, Korean, and English all work against all documents |
| Narrow to one language | Use the language filter |
| Search only your own documents, or only shared ones | Use the **Show** control beside the search box |
| Change the look | Account menu (your name, top right) → **Appearance** |
| Change your password | Account menu → **Change password** |

## 4. The two screens

### Search

A search box, a search button, and a control for how many results to show.

After a search you see the number of results and how long the search took, then the results themselves.

### Documents

Two lists: **My documents**, the files you added, and **Public documents**, the ones an administrator has shared with everyone. Each shows the filename, page count, number of searchable passages, detected language, and status. You can remove your own documents; public ones you can open and search, but not remove.

An **Index documents** button indexes your files. While a run is going the screen updates itself, and when it finishes you see how many documents were newly indexed, skipped, or could not be read. Only one run happens at a time for everyone; if someone else's is going, yours starts when you press the button again after it ends.

Administrators see one list of every document, with its owner, and a switch on each to make it public or private.

## 4a. Accounts

Everyone logs in. There is no email and no phone number: an account is a username and a password.

- **Creating an account.** Choose a username (3 to 32 English letters, digits, dots, dashes or underscores) and a password of at least 8 characters. An administrator can turn sign-up off, and can always create an account for you.
- **Your documents are yours.** Nobody else can see or search what you add, except administrators. An administrator can make any document **public**, and then everyone can find it.
- **The first account.** A new installation asks for an administrator account first. This has to be done on the computer DocSage is installed on.
- **Forgot your password?** On the login page, choose **Forgot your password?** and give your username. An administrator is asked to approve it. Once they do, the same page, in the same browser, lets you choose a new password. The request expires after 24 hours.
- **Or ask an administrator directly.** They can reset your password and give you a new one in person. You may be asked to choose your own the next time you log in.

### What administrators can do

- See, search, open and remove every document, and make any of them public or private
- Approve or deny password reset requests. Approve only a request you were expecting: whoever made it gets to choose the new password
- Create users, reset their passwords, make them administrators, disable them, or delete them with everything they own
- Open **Settings** and the **Admin** pages, which other users do not see
- Turn sign-up on or off

## 5. What a search result shows

Each result is one passage from one document, with:

- The **filename** it came from
- The **page number**, or a page range if the passage spans two pages
- A **relevance score** between 0 and 1, where higher is closer in meaning
- The **section heading** it sits under, when the document has one
- The **passage text** itself

Results are ordered by relevance, closest first.

## 6. Which documents work

**Works:**

- PDFs where the text can be selected and copied
- Word documents saved as .docx. Their page numbers are approximate (shown as `Page ~3`), because a Word file has no fixed pages
- Words split across lines, including hyphenated words and Korean words broken in the middle, come out whole
- Chinese, Korean, English, and documents mixing them
- Documents in nested subfolders
- Tables, which are kept whole with their header row

**Does not work in this version:**

- Scanned documents and photographed pages, where the text is really an image
- Password-protected PDFs and Word files
- Old Word files (.doc); save them as .docx first
- Damaged files

Unreadable files never stop a scan. They appear on the Documents tab with their status, damaged ones with the error that caused it, and everything else still gets indexed.

## 7. Keeping documents up to date

Press **Index documents** whenever the folder changes. The tool works out what to do on its own:

- A **new** file is indexed
- An **unchanged** file is skipped, so repeat scans are fast
- A **changed** file is re-indexed and its old content removed
- A **deleted** file is removed from the search index
- The **same file in two folders** is indexed once, and both locations are remembered

## 8. Privacy

This is the point of the tool, so it is worth stating plainly:

- No internet connection is needed to search or to index
- No document text is sent anywhere
- No search you type is sent anywhere, or written to a log
- No usage data is collected
- The search service is reachable only from your own machine, not from your network, unless you start it with `run.bat lan`. Then each person needs an account, and sees only their own documents, the ones an administrator made public, and nobody else's
- Accounts and passwords are stored on this machine only; passwords are stored hashed, never as typed

The only time the internet is needed is during first installation, to download the language model once.

## 9. Getting started

1. Install once, with the internet on. This downloads the language model, about 2.5 GB.
2. Start the tool and create the administrator account when it asks.
3. Open the Documents tab, press **Add documents**, and import your PDF and Word files. Files put in the `documents` folder by hand are indexed too, as the library, which only administrators see until they make documents public.

Indexing ten documents takes a few minutes the first time. After that you can disconnect from the internet entirely.

## 10. What to expect

| | |
|---|---|
| Search speed | Under one second |
| Starting the tool | Ten to thirty seconds, while the language model loads |
| Indexing speed | A few minutes for ten documents, then only new files are processed. On a Windows PC with an NVIDIA GeForce RTX card (20-series or newer, driver 580 or newer) indexing uses the graphics card and is much faster |
| Documents supported | Built for ten, designed to grow to thousands without rework |

## 11. Not in this version

These are recognised gaps, not oversights. Each is a candidate for a later release:

- Reading scanned documents, which needs text recognition
- Opening the source PDF at the matching page
- Exact keyword search alongside meaning-based search
- Watching the folder and indexing automatically
- Written answers to questions, rather than the passages themselves
- Saved search history
- Sharing a document with particular people rather than with everyone
- Password reset by email or text message, by design: DocSage keeps no contact details

## 12. Things worth knowing

- **Scores are relative, not absolute.** A top result at 0.62 is not a bad answer, it is the closest passage in your collection. Compare results to each other, not to a fixed threshold.
- **Results are passages, not whole documents.** The same document can appear several times if several of its passages match.
- **Cross-language results are genuine but ranked lower.** A Korean query usually surfaces Korean passages first, with matching Chinese passages below them.
- **Language detection is a label only.** Search never depends on it being right.
- **One search at a time is fastest.** Searching while a scan is running still works, but each search waits briefly for the scan to yield.

## 13. When something looks wrong

| What you see | What it means |
|---|---|
| "Cannot reach the backend" | The search service is not running. Start it. |
| Sent back to the login page | Your session ended: you were logged out elsewhere, or an administrator changed your account. Log in again. |
| "Too many attempts" | Several wrong passwords in a row. Wait a few minutes. |
| Nobody can log in as administrator | On the computer DocSage runs on: `scripts/reset_admin.py <username>` prints a new temporary password. |
| No results for anything | Nothing is indexed yet. Press **Index documents**. |
| A document shows "unsupported" | It is scanned or password-protected. Out of scope for this version. |
| A document shows "failed" | The file is damaged. The reason is shown next to it. |
| Results look unrelated | Check the Documents tab first: the document you expected may not be indexed. |

## 14. Done means

The MVP is finished when all of these are true:

- The tool starts and works with the internet switched off
- Ten of your own PDFs index successfully
- Chinese and Korean text comes through correctly, checked against the original pages
- A Chinese query finds relevant passages
- A Korean query finds relevant passages
- A query that shares no words with the target passage still finds it
- Every result names its file, page, score, and text
- Closing and restarting the tool loses nothing, with no re-indexing needed
