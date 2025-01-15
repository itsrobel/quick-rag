// app/api/scrape/route.ts
import { VercelPostgres } from "@langchain/community/vectorstores/vercel_postgres";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { encodingForModel } from "js-tiktoken";
import { OpenAIEmbeddings } from "@langchain/openai";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Keep existing CONFIG, ScrapeRequest interface, DocumentProcessor, and EarningsReportFetcher classes

interface ScrapeRequest {
  startYear: number;
  endYear: number;
}
const CONFIG = {
  QUARTERS: ["First", "Second", "Third", "Fourth"],
  BASE_URL: "https://ir.aboutamazon.com/news-release/news-release-details",
  BATCH_SIZE: 100,
  CHUNK_SIZE: 2000,
  CHUNK_OVERLAP: 200,
  MODEL_NAME: "gpt-3.5-turbo",
  RATE_LIMIT_DELAY: 1000,
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
  async fetchReport(year: number, quarter: string): Promise<Document | null> {
    const url = `${CONFIG.BASE_URL}/${year}/Amazon.com-Announces-${quarter}-Quarter-Results/`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const html = await response.text();
      const $ = cheerio.load(html);
      const content = $(".q4default").text().trim();

      if (!content) return null;

      return {
        pageContent: content,
        metadata: {
          source: url,
          year,
          quarter,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error(`Failed to fetch report for ${quarter} ${year}:`, error);
      return null;
    }
  }

  async fetchReportsInParallel(
    startYear: number,
    endYear: number,
  ): Promise<Document[]> {
    const fetchPromises: Promise<Document | null>[] = [];

    for (let year = startYear; year <= endYear; year++) {
      for (const quarter of CONFIG.QUARTERS) {
        fetchPromises.push(this.fetchReport(year, quarter));
      }
    }

    const reports = await Promise.all(fetchPromises);
    return reports.filter((report): report is Document => report !== null);
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
          connectionString: process.env.POSTGRES_DATABASE_URLL,
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

export async function POST(request: Request) {
  try {
    const { startYear, endYear }: ScrapeRequest = await request.json();

    // Initialize services
    const fetcher = new EarningsReportFetcher();
    const processor = new DocumentProcessor();
    const vectorStoreManager = new VectorStoreManager();

    // Fetch all reports in parallel
    const reports = await fetcher.fetchReportsInParallel(startYear, endYear);

    // Process all documents
    const chunksPromises = reports.map((report) =>
      processor.splitDocument(report),
    );
    const chunks = (await Promise.all(chunksPromises)).flat();

    // Initialize Vercel Postgres and store documents
    await vectorStoreManager.initialize();
    await vectorStoreManager.addDocumentsInBatches(chunks);

    return NextResponse.json({
      success: true,
      chunksProcessed: chunks.length,
      reportsProcessed: reports.length,
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
