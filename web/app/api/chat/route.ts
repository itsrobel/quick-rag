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
    temperature: 0.7,
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
    Given the following initial thought, evaluate its merit and expand on it:
    
    Initial Thought: {thought}
    Documents: {documents}
    Question: {question}

    1. Evaluation (1-10 score):
    2. Supporting Evidence:
    3. Potential Challenges:
    4. Refined Conclusion:
  `);

  // Final synthesis prompt
  const synthesisPrompt = PromptTemplate.fromTemplate(`
    Based on the following evaluated thoughts, synthesize a final comprehensive answer:

    Evaluated Thoughts:
    {evaluatedThoughts}

    Question: {question}

    Provide a well-reasoned final answer that incorporates the best insights from the different thought paths.
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

// Example usage:
// const result = await SummarizeWithToT(
//   documents,
//   "What are the key financial risks?",
// );
// console.log("Initial Thoughts:", result.initialThoughts);
// console.log("Evaluated Thoughts:", result.evaluatedThoughts);
// console.log("Final Answer:", result.finalAnswer);

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
    const summary = await SummarizeWithToT(search_results, prompt);

    return NextResponse.json({ response: summary });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to process search" },
      { status: 500 },
    );
  }
}
