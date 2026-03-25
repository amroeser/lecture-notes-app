# Lecture Batch Summarizer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-Whisper%20%2B%20GPT-412991?logo=openai)](https://openai.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> **Turn lecture videos into structured study notes — automatically.**
> Upload MP4s, get AI-powered transcripts, chapter summaries, and a complete study guide as Markdown or PDF.

<!-- Replace with an actual screenshot of your app -->
<!-- ![Lecture Batch Summarizer Screenshot](docs/screenshot.png) -->

## Quick Start

```bash
git clone https://github.com/amroeser/lecture-notes-app.git
cd lecture-notes-app
npm install
cp .env.example .env.local   # then add your OPENAI_API_KEY
./start.sh                    # opens at http://localhost:3000
```

> **Requirements:** Node.js (LTS), [ffmpeg](https://ffmpeg.org/) (`brew install ffmpeg` on macOS), and an [OpenAI API key](https://platform.openai.com/api-keys).

## How It Works

```
MP4 Upload → ffmpeg → Whisper Transcription → GPT Chapter Generation → Series Compilation → Markdown / PDF Export
```

1. **Upload** — Select one or more MP4 lecture recordings
2. **Transcription** — Audio is extracted via ffmpeg and transcribed using OpenAI Whisper
3. **Chapter Generation** — An LLM turns each transcript into a structured chapter (summary, learning objectives, key points, glossary, practice questions, etc.)
4. **Series Compilation** — All chapters are automatically sorted by learning progression, merged, and polished
5. **Export** — Download the final study guide as Markdown or PDF

## Example Output

Each chapter is generated with this structure:

```markdown
# Chapter: Navigation Rules on Inland Waters

## Summary
A 5-8 sentence overview of the lecture content...

## Learning Objectives
- Understand the basic rules of inland waterway navigation
- ...

## Key Points
- Maximum speed in swimming zones: 8 km/h (~4.3 knots)
- ...

## Glossary
| Term         | Definition                          |
|-------------|-------------------------------------|
| Starboard   | Right side of a vessel              |
| ...         | ...                                 |

## Practice Questions
1. Question: What is the maximum speed in a swimming zone?
   Answer: 8 km/h (~4.3 knots)
```

## Features

- **Batch Processing** — Process multiple videos simultaneously with configurable parallelism
- **Full Automation** — Auto-start batch, auto-generate series, auto-download results
- **Guardrails** — Automatic verification that all videos are included in the final output
- **Smart Caching** — Results are cached locally to avoid redundant API calls and costs
- **PDF Export** — Full study guide as PDF with tables, lists, and page breaks
- **Map-Reduce** — Large series are processed in chunks and then merged for optimal quality

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **Frontend** | React 19, Tailwind CSS |
| **Backend** | Next.js API Routes (Node.js) |
| **AI** | OpenAI API (Whisper + GPT) |
| **PDF** | jsPDF |
| **Audio** | ffmpeg |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key (used for transcription) |
| `OPENAI_BASE_URL` | No | Base URL for OpenAI-compatible providers |
| `OPENAI_TEXT_API_KEY` | No | Separate API key for text models (summaries/series) |
| `OPENAI_TEXT_BASE_URL` | No | Separate base URL for text models |
| `OPENAI_TRANSCRIBE_MODEL` | No | Transcription model (default: `gpt-4o-mini-transcribe`) |
| `OPENAI_SUMMARY_MODEL` | No | Model for chapter generation (default: `gpt-5.1-mini`) |
| `OPENAI_SERIES_MODEL` | No | Model for series compilation (default: same as summary) |
| `MAX_SERIES_COMPILE_CHARS` | No | Max chars for LLM compilation (default: `60000`) |
| `SERIES_CHUNK_SIZE` | No | Chapters per chunk in map-reduce (default: `4`) |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── process-lecture/   # MP4 → Transcript → Chapter
│   │   ├── series-summary/    # Chapters → Sorted series
│   │   ├── series-pdf/        # Markdown → PDF
│   │   └── _utils/            # Caching utilities
│   ├── page.tsx               # Entry point
│   └── layout.tsx
├── components/
│   └── LectureNotesApp.tsx    # Main UI component
```

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Feature: description'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a pull request

## Disclaimer

This project is provided **as-is without any warranty**. Use at your own risk.

- The quality of generated summaries depends on audio quality and the AI model used. **Results are not guaranteed to be error-free** and do not replace independent study.
- Using the OpenAI API incurs costs. The author assumes **no liability for API charges**.
- Make sure you have the **rights to upload** any video content and do not violate third-party copyrights.
- Transcripts and summaries are cached locally. Users are responsible for protecting sensitive data.

## Author

**Alexander Maximilian Röser**

- GitHub: [@amroeser](https://github.com/amroeser)
- Blog: [alexanderroeser.de](https://alexanderroeser.de)

## License

This project is licensed under the [MIT License](LICENSE).
