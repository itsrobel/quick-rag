"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  const [messages, setMessages] = useState([
    { id: 1, text: "Hello! How can I help you today?", sender: "bot" },
  ]);
  const [inputText, setInputText] = useState("");
  const [showSources, setShowSources] = useState(false);

  const handleToggle = () => {
    setShowSources((prev) => !prev);
  };
  const handleIndexing = async () => {
    const res = await fetch("/api/scrape", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log(res.json());
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;

    setMessages((prev) => [
      ...prev,
      { id: prev.length + 1, text: inputText, sender: "user" },
    ]);
    setInputText("");

    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ prompt: inputText }),
    });

    const data = await res.json();
    // Simulate bot response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          text: data.response,
          sender: "bot",
        },
      ]);
      if (showSources) {
        setMessages((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            text: data.sources,
            sender: "bot",
          },
        ]);
      }
    }, 1000);
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b flex justify-between px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Chat Interface</h1>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showSources}
              onChange={handleToggle}
              className="sr-only peer"
            />
            <div
              className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-300 
          peer-checked:after:translate-x-full peer-checked:bg-blue-600 
          after:content-[''] after:absolute after:top-[2px] after:left-[2px] 
          after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"
            ></div>
          </label>
          <span className="text-sm font-medium text-gray-700">
            {showSources ? "Hide Sources" : "Show Sources"}
          </span>
        </div>
        <Button onClick={handleIndexing}>Index Reports</Button>
      </header>

      <ScrollArea className="flex-1 p-4">
        <div className="flex flex-col gap-4 max-w-3xl mx-auto">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <Card
                className={`max-w-[70%] ${
                  message.sender === "user" ? "bg-primary" : "bg-muted"
                }`}
              >
                <CardContent
                  className={`p-3 ${
                    message.sender === "user"
                      ? "text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {message.text}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </ScrollArea>

      <footer className="border-t p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
            className="flex-1"
          />
          <Button onClick={handleSend}>Send</Button>
        </div>
      </footer>
    </div>
  );
}
