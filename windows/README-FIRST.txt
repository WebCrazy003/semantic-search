DocSage
===========================

Semantic search over Chinese and Korean PDFs and Word files, running entirely on
this computer.
No internet connection is needed, now or ever. Nothing is sent anywhere.


Getting started
---------------

1. Double-click run.bat. The first start takes a minute or two while the
   embedding model loads; after that it is quick.

2. Your browser opens at http://127.0.0.1:8000/

3. The first time, create the administrator account. This only works on this
   computer, not from another one on the network.

4. On the Documents tab, press "Add documents" and import PDF or Word (.docx)
   files. Each person's files are private to them; an administrator can make
   any document public so everyone can find it. Files put into the documents
   folder next to this file by hand are indexed too, visible to
   administrators until they make them public.

5. Press "Index documents". Indexing reads every page and is slow the first
   time. It picks up where it left off if you stop it.

6. Search from the Search tab. Chinese and Korean queries both work, and a
   query in one language finds passages in the other.

Double-click stop.bat when you are finished, or just close the window titled
"SPS Server".


If something goes wrong
-----------------------

Run check.bat. It tests every part of the installation and says which one
failed.

"PyTorch failed to import", or an error about a missing DLL
    Right-click runtime\vc_redist.x64.exe and choose "Run as administrator".
    This installs a Microsoft system library that most computers already have.

"Already running"
    Run stop.bat first, then run.bat.

Search finds nothing
    Check the Documents tab shows your files as indexed. If the counts look
    wrong, stop the app and run this from a command prompt in this folder:
        runtime\python\python.exe scripts\rebuild_manifest.py

A PDF or Word file will not index
    Scanned or image-only PDFs have no text to read, and encrypted files cannot
    be opened. Both are reported as "unsupported". Old Word files (.doc) are not
    read at all: open them in Word and save them as .docx.

Indexing is slow
    The Indexing page says whether it runs on the GPU or the CPU. With an NVIDIA
    GeForce RTX card (20-series or newer), install an NVIDIA display driver,
    version 528 or newer (570 or newer for an RTX 50-series card); nothing
    else is needed. Without one, indexing uses the CPU, which works but takes
    longer. Searching is fast either way.


Sharing it on your network
--------------------------

run.bat lan  serves the interface to other computers on the same network and
prints the address to use. There is NO login: anyone who can reach that address
can search every indexed document, open the PDFs and clear the index. Use it
only on a network you trust, and go back to plain run.bat afterwards.


What is in this folder
----------------------

documents\        put your PDF and Word files here
qdrant_storage\   the search index; delete it to start over, then re-index
data\             bookkeeping about which files were indexed
models\           the embedding model
runtime\          Python and the libraries; do not change anything in here
.env              settings, plain text, safe to edit with Notepad

You can move or rename this whole folder; nothing points outside it.


Accounts
--------

Everyone logs in with a username and password. There is no email.

Forgot your password?
    Choose "Forgot your password?" on the login page and give your
    username. An administrator approves it on the Users page, and then the
    same page lets you choose a new one. An administrator can also reset a
    password directly.

No administrator can log in
    DocSage can keep running. Open a command prompt in this folder and run:
        runtime\python\python.exe scripts\reset_admin.py <username>
    It prints a temporary password to log in with.

Back up data\access.db
    It holds the accounts and which documents are public. Unlike the rest
    of the data folder, nothing can rebuild it.
