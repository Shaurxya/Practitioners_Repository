import { HeroCardDark, ProductCard, FeatureCard, ResourceCard, CalloutStat } from '@/components/ui/Cards'
import { Button } from '@/components/ui/Button'
import { PillTab } from '@/components/ui/Tabs'
import { TextField } from '@/components/ui/Field'
import { faMicrochip, faServer, faNetworkWired } from '@fortawesome/free-solid-svg-icons'
import { useState } from 'react'

export function ThemeDemoPage() {
  const [activeTab, setActiveTab] = useState('All')

  return (
    <div className="bg-canvas min-h-screen pb-section">
      
      {/* HERO SECTION */}
      <HeroCardDark 
        headline="Accelerating the Future of AI"
        subhead="Discover the most advanced platform for generative AI, data science, and high-performance computing."
        ctaText="Explore Our AI Solutions"
      />

      {/* TABS SECTION */}
      <div className="bg-surface-soft border-b border-hairline px-xl py-4 flex items-center gap-2 mb-section">
        <span className="text-body-strong text-ink mr-4">Filter by:</span>
        {['All', 'Hardware', 'Software', 'Services'].map(tab => (
          <PillTab 
            key={tab} 
            active={activeTab === tab} 
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </PillTab>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-xl space-y-section">
        
        {/* FEATURES GRID */}
        <div>
          <h2 className="text-display-lg font-bold text-ink mb-xl">Platform Capabilities</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-xl">
            <FeatureCard 
              icon={faMicrochip}
              title="Agentic AI"
              description="Build and deploy autonomous agents powered by state-of-the-art models and optimized inference engines."
            />
            <FeatureCard 
              icon={faServer}
              title="Data Science"
              description="Accelerate end-to-end data pipelines with GPU-optimized libraries for data processing and machine learning."
            />
            <FeatureCard 
              icon={faNetworkWired}
              title="Conversational AI"
              description="Create highly accurate, intelligent conversational interfaces customized for your domain."
            />
          </div>
        </div>

        {/* CTA STRIP */}
        <div className="bg-surface-dark px-xxl py-xl flex flex-col md:flex-row items-center justify-between border-t border-hairline-strong">
          <h2 className="text-heading-xl font-bold text-on-dark mb-4 md:mb-0">Ready to get started?</h2>
          <div className="flex gap-4">
            <Button variant="outline-on-dark">Read Documentation</Button>
            <Button variant="primary">Contact Sales</Button>
          </div>
        </div>

        {/* PRODUCTS & RESOURCES */}
        <div>
          <h2 className="text-display-lg font-bold text-ink mb-xl">Featured Solutions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-xl">
            <ProductCard 
              imageSrc="https://picsum.photos/seed/gpu/800/450"
              title="HGX H100 GPU"
              description="The world's most advanced GPU for generative AI and LLMs, featuring the Hopper architecture."
            />
            <ResourceCard 
              type="WHITE PAPER"
              imageSrc="https://picsum.photos/seed/wp/800/450"
              title="Scaling LLM Training"
              description="Learn how to optimize distributed training performance across massive GPU clusters."
            />
          </div>
        </div>

        {/* STATS & FORMS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-xl items-start">
          <CalloutStat 
            stat="4x" 
            caption="Faster training performance on large language models compared to previous generation." 
          />
          <div className="bg-canvas border border-hairline p-xxl rounded-[--radius-sm]">
            <h3 className="text-heading-md font-bold text-ink mb-4">Request Access</h3>
            <div className="space-y-4">
              <TextField label="Business Email" placeholder="name@company.com" />
              <Button variant="primary" className="w-full mt-2">Submit Request</Button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
