# DocSage: User Specification

**Version:** MVP 1.0
**Date:** 2026-09-20, written answers added 2026-10-04
**Companion document:** the developer plan in `docs/superpowers/plans/`

---

## 1. What this is

A search tool for your own PDF and Word documents that understands **meaning**, not just matching words.

Ask "how often should the seals be replaced" and it finds the passage about maintenance intervals, even when that passage never uses the word "often". Ask in Korean and it can find the answer inside a Chinese document.

Ask a question the way you would ask a colleague and, on a computer with a suitable graphics card, it also writes a short answer from the passages it found, in the language you asked in, with every point linked to the page it came from.

Everything runs on your own machine. No document, no search, no answer, and no part of your data ever leaves it.

## 2. Who it is for

Someone with a folder of technical manuals, contracts, or reports in Chinese, Korean, or English, who needs to find the right paragraph quickly and cannot send those documents to a cloud service.

## 3. What you can do

| You want to | You do this |
|---|---|
| Make documents searchable | On the **Documents** tab, press **Add documents** and import PDF or Word (.docx) files |
| Find a passage | Type a question or phrase, press **Search** |
| Get a written answer | Ask a question in English, Chinese or Korean, press **Search**. The answer appears above the results |
| Check where an answer came from | Click a numbered marker such as **1** in the answer: the passage it came from opens |
| Turn written answers off | Account menu → **Appearance** → **Answer questions with AI** |
| See what is searchable | Open the **Documents** tab |
| Search across languages | Just search. Chinese, Korean, and English all work against all documents |
| Narrow to one language | Use the language filter |
| Search only your own documents, or only shared ones | Use the **Show** control beside the search box |
| Change the look | Account menu (your name, top right) → **Appearance** |
| Change your password | Account menu → **Change password** |

## 4. The two screens

### Search

A search box, a search button, and a control for how many results to show.

After a search the results appear straight away: the number of results, how long the search took, then the results themselves. Where written answers are available, an **Answer** box sits above the results and fills in while you read them. On a laptop it usually takes a few seconds to start writing; **Stop** ends it early, and the results stay either way. See §5a.

### Documents

Two lists: **My documents**, the files you added, and **Public documents**, the ones an administrator has shared with everyone. Each shows the filename, page count, number of searchable passages, detected language, and status. You can remove your own documents; public ones you can open and search, but not remove.

**Add documents** opens **Import & index files**: drop PDF or Word files in and they are copied into your own folder and indexed straight away, with no second button to press. While the run is going you see its progress and how hard the GPU or CPU is working; when it finishes you see how many documents were newly indexed, skipped, or could not be read. Only one run happens at a time for everyone; if someone else's is going, your files are saved and indexed as soon as it ends.

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

## 5a. What a written answer shows

- **A short answer in the language you asked in.** Ask in English and the answer is in English, in Chinese and it is in Chinese (Simplified or Traditional, as you wrote it), in Korean and it is in Korean, whatever language the documents are in. A question in any other language is answered in English, with a note saying so.
- **A numbered marker after each point**, such as **1** or **2**. Click it and the passage it came from opens; the same number appears on that result in the list below. Numbers, units and part names are copied exactly as the document writes them; a term translated from another language keeps the original in brackets, for example 필터 카트리지(滤芯).
- **The sources it used**, each with its file and page.
- **"Generated from your documents. Check the sources."** The answer is written by a language model running on this computer from the passages found, and can still be wrong. For anything that matters, open the source.

When nothing in your documents answers the question, it says so instead of guessing: *"I couldn't find this in your documents."* A question that has nothing to do with your documents gets that reply at once.

An answer only ever draws on documents you are allowed to see: your own and the public ones.

**What answers need.** A graphics card the program can use: an NVIDIA card (RTX 20 series or newer) on Windows, or any Apple Silicon Mac. Without one, writing an answer takes about a minute, so answers stay off and search works as before; an administrator can turn them on anyway. On a graphics card a full answer usually takes 3 to 10 seconds; on an Apple M1, around 5 to 20.

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

Every import starts an indexing run, and the run works out what to do on its own. A regular user's run covers their own uploads; an administrator's covers the whole documents folder, including files put there by hand:

- A **new** file is indexed
- An **unchanged** file is skipped, so repeat scans are fast
- A **changed** file is re-indexed and its old content removed
- A **deleted** file is removed from the search index
- The **same file in two folders** is indexed once, and both locations are remembered

## 8. Privacy

This is the point of the tool, so it is worth stating plainly:

- No internet connection is needed to search, to index, or to get a written answer
- Answers are written by a language model running on this computer. Your question and the passages it reads are not sent anywhere
- No document text is sent anywhere
- No search you type is sent anywhere, or written to a log, and neither is any answer
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
| Starting the tool | Ten to thirty seconds, while the language model loads; a little longer with written answers on |
| Written answers | The results first, at once; the answer fills in above them, typically within 3 to 10 seconds on an NVIDIA graphics card and 5 to 20 on an Apple M1. One answer is written at a time; with several people asking at once, the others wait their turn, but their results do not |
| Indexing speed | A few minutes for ten documents, then only new files are processed. On a Windows PC with an NVIDIA GeForce RTX card (20-series or newer, driver 528 or newer, 570 or newer for RTX 50) indexing uses the graphics card and is much faster |
| Documents supported | Built for ten, designed to grow to thousands without rework |

## 11. Not in this version

These are recognised gaps, not oversights. Each is a candidate for a later release:

- Reading scanned documents, which needs text recognition
- Opening the source PDF at the matching page
- Exact keyword search alongside meaning-based search
- Watching the folder and indexing automatically
- Follow-up questions that build on the previous answer, as in a conversation
- Saved search history
- Sharing a document with particular people rather than with everyone
- Password reset by email or text message, by design: DocSage keeps no contact details

## 12. Things worth knowing

- **Scores are relative, not absolute.** A top result at 0.62 is not a bad answer, it is the closest passage in your collection. Compare results to each other, not to a fixed threshold.
- **Results are passages, not whole documents.** The same document can appear several times if several of its passages match.
- **Cross-language results are genuine but ranked lower.** A Korean query usually surfaces Korean passages first, with matching Chinese passages below them.
- **Language detection is a label only.** Search never depends on it being right.
- **A written answer is a summary, not the document.** It is drawn only from the passages shown under it and says when they do not answer the question, but a small language model can still misread a passage. The numbered markers are there so you can check.
- **One search at a time is fastest.** Searching while a scan is running still works, but each search waits briefly for the scan to yield.

## 13. When something looks wrong

| What you see | What it means |
|---|---|
| "Cannot reach the backend" | The search service is not running. Start it. |
| Sent back to the login page | Your session ended: you were logged out elsewhere, or an administrator changed your account. Log in again. |
| "Too many attempts" | Several password reset requests from this computer within an hour. Wait and try again. |
| Nobody can log in as administrator | On the computer DocSage runs on: `scripts/reset_admin.py <username>` prints a new temporary password. |
| No results for anything | Nothing is indexed yet. Import your files with **Add documents** on the Documents tab. |
| A document shows "unsupported" | It is scanned or password-protected. Out of scope for this version. |
| A document shows "failed" | The file is damaged. The reason is shown next to it. |
| Results look unrelated | Check the Documents tab first: the document you expected may not be indexed. |
| No **Answer** box above the results | Answers are off: switched off under **Appearance**, or this computer has no graphics card answers can use, or the answer model is not running. Search works as before. |
| "The answer model is not running" | The results are fine; only the answer is missing. Restart DocSage, or ask an administrator to. |
| "I couldn't find this in your documents" | Nothing found answers the question. Read the results anyway, or ask more specifically. |

## 14. Done means

The MVP is finished when all of these are true:

- The tool starts and works with the internet switched off
- Ten of your own PDFs index successfully
- Chinese and Korean text comes through correctly, checked against the original pages
- A Chinese query finds relevant passages
- A Korean query finds relevant passages
- A query that shares no words with the target passage still finds it
- Every result names its file, page, score, and text
- A question in English, Chinese or Korean gets a written answer in that language, with markers that open the passages it came from, on a computer with a suitable graphics card
- A question the documents cannot answer gets "not found", not a guess
- Closing and restarting the tool loses nothing, with no re-indexing needed
