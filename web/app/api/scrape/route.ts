// app/api/scrape/route.ts
import { VercelPostgres } from "@langchain/community/vectorstores/vercel_postgres";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { encodingForModel } from "js-tiktoken";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Keep existing CONFIG, ScrapeRequest interface, DocumentProcessor, and EarningsReportFetcher classes

const CONFIG = {
  QUARTERS: ["First", "Second", "Third", "Fourth"],
  YEARS: [2024, 2023, 2022, 2021, 2020],
  BASE_URL: "https://ir.aboutamazon.com/news-release/news-release-details",
  BATCH_SIZE: 100,
  CHUNK_SIZE: 2000,
  CHUNK_OVERLAP: 200,
  MODEL_NAME: "gpt-3.5-turbo",
  RATE_LIMIT_DELAY: 10,
} as const;

class DocumentProcessor {
  private readonly textSplitter: RecursiveCharacterTextSplitter;
  private readonly encoder;

  constructor() {
    this.encoder = encodingForModel(CONFIG.MODEL_NAME);
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: CONFIG.CHUNK_SIZE,
      chunkOverlap: CONFIG.CHUNK_OVERLAP,
      lengthFunction: (text) => this.encoder.encode(text).length,
    });
  }

  async splitDocument(doc: Document): Promise<Document[]> {
    return this.textSplitter.splitDocuments([doc]);
  }
}

class EarningsReportFetcher {
  private readonly processor: DocumentProcessor;

  constructor() {
    this.processor = new DocumentProcessor();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchAndProcessReport(
    year: number,
    quarter: string,
  ): Promise<Document[] | null> {
    const url = `${CONFIG.BASE_URL}/${year}/Amazon.com-Announces-${quarter}-Quarter-Results/`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const html = await response.text();
      const $ = cheerio.load(html);
      const content = $(".q4default").text().trim();

      if (!content) return null;
      console.log(`Fetched report for ${quarter} ${year}`);

      const document = {
        pageContent: content,
        metadata: {
          source: url,
          year,
          quarter,
          timestamp: new Date().toISOString(),
        },
      };

      // Process document immediately after fetching
      const chunks = await this.processor.splitDocument(document);
      console.log(
        `Split ${quarter} ${year} report into ${chunks.length} chunks`,
      );
      return chunks;
    } catch (error) {
      console.error(`Failed to fetch report for ${quarter} ${year}:`, error);
      return null;
    }
  }

  async fetchAndProcessAllReports(
    startYear: number,
    endYear: number,
  ): Promise<Document[]> {
    const tasks: Array<Promise<Document[] | null>> = [];

    for (let year = startYear; year <= endYear; year++) {
      for (const quarter of CONFIG.QUARTERS) {
        if (year === 2024 && quarter === "Fourth") continue;

        const task = this.delay(tasks.length * CONFIG.RATE_LIMIT_DELAY).then(
          () => this.fetchAndProcessReport(year, quarter),
        );
        tasks.push(task);
      }
    }

    const results = await Promise.all(tasks);
    return results
      .filter((chunks): chunks is Document[] => chunks !== null)
      .flat();
  }
}

class VectorStoreManager {
  private vectorStore: VercelPostgres | null = null;

  async initialize() {
    if (!this.vectorStore) {
      const embeddings = new OpenAIEmbeddings();
      this.vectorStore = await VercelPostgres.initialize(embeddings, {
        tableName: process.env.COLLECTION_NAME || "amazon_earnings",
        postgresConnectionOptions: {
          connectionString: process.env.POSTGRES_DATABASE_URL,
        },
      });
    }
    console.log("Vector store initialized");
    return this.vectorStore;
  }

  async addDocumentsInBatches(documents: Document[]) {
    if (!this.vectorStore) throw new Error("Vector store not initialized");
    for (let i = 0; i < documents.length; i += CONFIG.BATCH_SIZE) {
      const batch = documents.slice(i, i + CONFIG.BATCH_SIZE);
      console.log(`Adding batch of ${batch.length} documents`);
      await this.vectorStore.addDocuments(batch);
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY),
      );
    }
  }
}

export async function GET() {
  try {
    const fetcher = new EarningsReportFetcher();
    const vectorStoreManager = new VectorStoreManager();

    const processingPromise = (async () => {
      console.log("Starting fetch and process operation...");
      const chunks = await fetcher.fetchAndProcessAllReports(2020, 2024);
      console.log(`Processed ${chunks.length} total chunks`);

      await vectorStoreManager.initialize();
      await vectorStoreManager.addDocumentsInBatches(chunks);
    })();

    // Fire and forget - handle errors in the background
    processingPromise.catch((error) => {
      console.error("Background processing error:", error);
    });
    return NextResponse.json({
      success: true,
      message: "Processing started",
    });
  } catch (error) {
    console.error("Processing error:", error);
    return NextResponse.json(
      {
        error: "Failed to process reports",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
