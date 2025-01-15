// app/scrape/page.tsx
"use client";
import { useState } from "react";

export default function ScrapePage() {
  const [startYear, setStartYear] = useState(2020);
  const [endYear, setEndYear] = useState(2024);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState("");

  const handleScrape = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        body: JSON.stringify({ startYear, endYear }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      setResult(`Successfully processed ${data.reportsProcessed} reports`);
    } catch (error) {
      setResult("Error processing reports");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl mb-4">Amazon Earnings Scraper</h1>
      <div className="space-y-4">
        <div>
          <label className="block">Start Year:</label>
          <input
            type="number"
            value={startYear}
            onChange={(e) => setStartYear(parseInt(e.target.value))}
            className="border p-2"
          />
        </div>
        <div>
          <label className="block">End Year:</label>
          <input
            type="number"
            value={endYear}
            onChange={(e) => setEndYear(parseInt(e.target.value))}
            className="border p-2"
          />
        </div>
        <button
          onClick={handleScrape}
          disabled={isLoading}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          {isLoading ? "Processing..." : "Start Scraping"}
        </button>
        {result && <div className="mt-4">{result}</div>}
      </div>
    </div>
  );
}
