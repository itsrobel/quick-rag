// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { VercelPostgres } from "@langchain/community/vectorstores/vercel_postgres";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { formatDocumentsAsString } from "langchain/util/document";

async function Summarize(documents: Document[], question: string) {
  try {
    const model = new ChatOpenAI({
      modelName: "gpt-3.5-turbo",
      temperature: 0.7,
    });

    const prompt = PromptTemplate.fromTemplate(`
      You are an expert financial analyst. Based on the following documents, summarize the key points that answer the question: {question}

      Documents:
      {documents}

      Provide a concise summary.
    `);

    const chain = RunnableSequence.from([
      {
        documents: (input) => formatDocumentsAsString(input.documents),
        question: (input) => input.question,
      },
      prompt,
      model,
      new StringOutputParser(),
    ]);

    const response = await chain.invoke({
      documents,
      question,
    });

    return response;
  } catch (error) {
    console.error("Summary generation error:", error);
    throw new Error("Failed to generate summary");
  }
}

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Invalid prompt provided" },
        { status: 400 },
      );
    }

    const embeddings = new OpenAIEmbeddings();

    const vectorStore = await VercelPostgres.initialize(embeddings, {
      tableName: process.env.COLLECTION_NAME || "amazon_earnings",
      postgresConnectionOptions: {
        connectionString: process.env.POSTGRES_DATABASE_URL,
      },
    });

    const search_results = await vectorStore.similaritySearch(prompt);
    console.log("search complete with query: ", prompt);
    const summary = await Summarize(search_results, prompt);

    return NextResponse.json({ response: summary });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to process search" },
      { status: 500 },
    );
  }
}
