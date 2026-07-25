<script lang="ts">

import { Chat } from "@ai-sdk/svelte";

let input = "";

const chat = new Chat({
    api: "/api/chat"
});


function submit(e: SubmitEvent) {

    e.preventDefault();

    chat.sendMessage({
        text: input
    });

    input = "";
}

</script>


<h1>
Legal Research Assistant
</h1>


<div>

{#each chat.messages as message}

    <div class="message">

        <strong>
            {message.role}
        </strong>

        {#each message.parts as part}

            {#if part.type === "text"}

                <p>
                    {part.text}
                </p>

            {/if}

        {/each}

    </div>

{/each}

</div>


<form onsubmit={submit}>

<input
    bind:value={input}
    placeholder="Ask about cases..."
/>

<button>
Send
</button>

</form>