import { openai } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { z } from "zod";

export async function POST({ request }) {

    const { messages } = await request.json();

    const result = streamText({
        model: openai("gpt-5-mini"),

        messages,

        tools: {

            searchDecisions: tool({
                description:
                    "Search legal decisions by court and topic",

                inputSchema: z.object({
                    court: z.string().optional(),
                    topic: z.string().optional()
                }),

                execute: async ({court, topic}) => {

                    // Replace with Prisma query
                    return [
                        {
                            title: "Smith v Minister",
                            court,
                            year: 2024,
                            topic
                        },
                        {
                            title: "Jones v State",
                            court,
                            year: 2023,
                            topic
                        }
                    ];
                }
            })

        }
    });


    return result.toUIMessageStreamResponse();
}