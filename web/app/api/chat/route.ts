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

async function SummarizeWithToT(documents: Document[], question: string) {
  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    temperature: 0.8,
  });

  // First, generate multiple initial thoughts
  const thoughtGenerationPrompt = PromptTemplate.fromTemplate(`
    You are an expert financial analyst. Based on the following documents, generate three different initial perspectives or approaches to answer the question.

    Documents:
    {documents}

    Question: {question}

    Generate three distinct initial thoughts, labeled as A, B, and C:
  `);

  // Then evaluate and expand each thought
  const thoughtEvaluationPrompt = PromptTemplate.fromTemplate(`
  Given the following initial thought, evaluate it focusing on specific financial data:
    
    Initial Thought: {thought}
    Documents: {documents}
    Question: {question}

    1. Evaluation (1-10 score):
    2. Specific Financial Data Found:
    3. Year and Numbers Identified:
    4. Concrete Conclusion:
  `);

  const synthesisPrompt = PromptTemplate.fromTemplate(`
  Based on the following evaluated thoughts and the provided documents, synthesize a final answer:

  Evaluated Thoughts:
  {evaluatedThoughts}

  Question: {question}

  Instructions:
  1. Use ONLY the information present in the evaluated thoughts and documents
  2. Provide a clear, direct answer with specific numbers and dates
  3. Include a brief explanation of how you arrived at this conclusion
  4. If the information is not available in the documents, state that clearly

  Format your response as:
  Answer: [Direct answer with specific numbers]
  Reasoning: [Brief explanation based on the analyzed thoughts]
`);

  async function generateInitialThoughts() {
    const initialThoughts = await RunnableSequence.from([
      {
        documents: (input) => formatDocumentsAsString(input.documents),
        question: (input) => input.question,
      },
      thoughtGenerationPrompt,
      model,
      new StringOutputParser(),
    ]).invoke({
      documents,
      question,
    });

    // Parse the response into separate thoughts
    return initialThoughts.split("\n").filter((t) => t.trim().length > 0);
  }

  async function evaluateThought(thought: string) {
    return RunnableSequence.from([
      {
        thought: () => thought,
        documents: (input) => formatDocumentsAsString(input.documents),
        question: (input) => input.question,
      },
      thoughtEvaluationPrompt,
      model,
      new StringOutputParser(),
    ]).invoke({
      documents,
      question,
    });
  }

  async function synthesizeFinalAnswer(evaluatedThoughts: string[]) {
    return RunnableSequence.from([
      {
        evaluatedThoughts: () => evaluatedThoughts.join("\n\n"),
        question: (input) => input.question,
      },
      synthesisPrompt,
      model,
      new StringOutputParser(),
    ]).invoke({
      question,
    });
  }

  try {
    // 1. Generate initial thoughts
    const initialThoughts = await generateInitialThoughts();

    // 2. Evaluate each thought path
    const evaluatedThoughts = await Promise.all(
      initialThoughts.map((thought) => evaluateThought(thought)),
    );

    // 3. Synthesize final answer
    const finalAnswer = await synthesizeFinalAnswer(evaluatedThoughts);
    console.log("Initial Thoughts:", initialThoughts);

    return {
      initialThoughts,
      evaluatedThoughts,
      finalAnswer,
    };
  } catch (error) {
    console.error("Tree of thoughts analysis error:", error);
    throw new Error("Failed to generate tree of thoughts analysis");
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
    const summary = await SummarizeWithToT(search_results, prompt);
    console.log(search_results);
    const sources = search_results.map((r) => r.metadata.source);

    return NextResponse.json({
      response: summary.finalAnswer,
      sources: sources,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to process search" },
      { status: 500 },
    );
  }
}
